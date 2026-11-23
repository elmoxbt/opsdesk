import { Inject, Logger, type OnModuleDestroy } from "@nestjs/common";
import { type OnGatewayInit, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { type JobChangedEvent, REALTIME_EVENTS } from "@opsdesk/shared";
import { parse as parseCookie } from "cookie";
import type { Subscription } from "rxjs";
import type { Server, Socket } from "socket.io";
import type { RequestUser } from "../auth/auth.types";
import { ACCESS_COOKIE } from "../auth/cookies";
import { SessionService } from "../auth/session.service";
import { ENV, type Env } from "../config/env";
import { DomainEvents, type JobChanged } from "./domain-events";

/** Rooms are the authorization boundary for pushes: tenant + role, or a single user. */
export const rooms = {
  managers: (orgId: string) => `org:${orgId}:managers`,
  user: (userId: string) => `user:${userId}`,
};

export function tokenFromHandshake(h: Socket["handshake"]): string | undefined {
  const auth = h.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === "string" && auth.token) return auth.token;
  const header = h.headers.cookie;
  return header ? parseCookie(header)[ACCESS_COOKIE] : undefined;
}

/**
 * Live updates for the dispatch board and job pages.
 * - Handshake auth reuses SessionService (same rules as HTTP); failures surface
 *   to the client as connect_error "UNAUTHENTICATED" so it can refresh and retry.
 * - Owners/dispatchers join their org's managers room; everyone joins a personal
 *   room. Technicians therefore only ever receive their own jobs, mirroring the
 *   REST rules, and nothing ever crosses tenants.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger("Realtime");
  private subscription?: Subscription;

  constructor(
    private readonly sessions: SessionService,
    private readonly events: DomainEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      // WebSocket upgrades aren't covered by browser CORS. Since the access cookie
      // rides along on the handshake, reject foreign browser origins explicitly
      // (cross-site WebSocket hijacking). Non-browser clients send no Origin and
      // must authenticate with an explicit token.
      const origin = socket.handshake.headers.origin;
      if (origin && !this.env.WEB_ORIGIN.includes(origin)) return next(new Error("FORBIDDEN_ORIGIN"));
      const token = tokenFromHandshake(socket.handshake);
      if (!token) return next(new Error("UNAUTHENTICATED"));
      this.sessions
        .resolve(token)
        .then((user) => {
          socket.data.user = user;
          next();
        })
        .catch(() => next(new Error("UNAUTHENTICATED")));
    });

    server.on("connection", (socket: Socket) => {
      const user = socket.data.user as RequestUser;
      void socket.join(
        user.role === "TECHNICIAN"
          ? [rooms.user(user.id)]
          : [rooms.user(user.id), rooms.managers(user.organizationId)],
      );
    });

    this.subscription = this.events.stream$.subscribe((event) => {
      if (event.type === "job.changed")
        void this.pushJob(event).catch((e: unknown) => this.logger.error("push failed", e));
      // Billing is manager-only information: technicians never get these.
      if (event.type === "invoice.paid")
        this.server.to(rooms.managers(event.organizationId)).emit(REALTIME_EVENTS.invoicePaid, event.event);
      if (event.type === "user.deactivated") this.server.in(rooms.user(event.userId)).disconnectSockets(true);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private async pushJob(e: JobChanged): Promise<void> {
    const targets = [rooms.managers(e.organizationId)];
    if (e.job.technician) targets.push(rooms.user(e.job.technician.id));
    if (e.previousTechnicianId && e.previousTechnicianId !== e.job.technician?.id)
      targets.push(rooms.user(e.previousTechnicianId));
    const name = e.actorId ? await this.sessions.displayName(e.actorId) : null;
    const payload: JobChangedEvent = {
      kind: e.kind,
      job: e.job,
      actor: e.actorId && name ? { id: e.actorId, name } : null,
    };
    this.server.to(targets).emit(REALTIME_EVENTS.jobChanged, payload);
  }
}
