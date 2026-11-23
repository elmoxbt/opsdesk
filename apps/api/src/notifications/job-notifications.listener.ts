import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { ClientConfig } from "@opsdesk/config";
import { tenantContext } from "@opsdesk/db";
import type { Subscription } from "rxjs";
import { CLIENT_CONFIG } from "../config/config.module";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { type JobPayloads, QueueService } from "../queue/queue.service";
import { DomainEvents, type JobChanged } from "../realtime/domain-events";
import { NotificationService } from "./notification.service";

export const formatWhen = (iso: string | Date, c: ClientConfig): string =>
  new Intl.DateTimeFormat(c.business.locale, {
    timeZone: c.business.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export const bookingStatusUrl = (env: Env, orgSlug: string, token: string) =>
  `${env.APP_URL.replace(/\/$/, "")}/book/${orgSlug}/b/${token}`;

type JobMessage = JobPayloads["notification.job"];

/**
 * Keeps customers informed from the same domain events that drive the live
 * dashboard: confirmed (with time + technician), on the way, done, cancelled.
 * Services don't call this; it listens. Dedupe keys make a re-published event,
 * a double click or a reconnect replay harmless, while a real reschedule
 * (new time or technician) does send a new confirmation.
 *
 * The listener only DECIDES (synchronously, from the event) and enqueues; the
 * lookup and sending run as a queued job, so nothing is lost if the process
 * restarts between the change and the message.
 */
@Injectable()
export class JobNotificationsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobNotificationsListener.name);
  private sub?: Subscription;

  constructor(
    private readonly events: DomainEvents,
    private readonly notify: NotificationService,
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.queue.register("notification.job", (p) =>
      tenantContext.runAsync({ organizationId: p.organizationId }, () => this.handle(p)),
    );
    this.sub = this.events.stream$.subscribe((e) => {
      if (e.type !== "job.changed") return;
      const message = this.pick(e);
      if (!message) return;
      this.queue
        .enqueue("notification.job", {
          organizationId: e.organizationId,
          jobId: e.job.id,
          message,
          scheduledStart: e.job.scheduledStart,
          technicianId: e.job.technician?.id ?? null,
        })
        .catch((err: unknown) => this.logger.error(`could not queue job notification: ${String(err)}`));
    });
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
  }

  async handle(p: JobMessage): Promise<void> {
    const job = await this.prisma.db.job.findUnique({
      where: { id: p.jobId },
      select: {
        id: true,
        bookingToken: true,
        scheduledStart: true,
        customer: { select: { name: true, email: true, phone: true } },
        serviceType: { select: { name: true } },
        technician: { select: { name: true } },
        organization: { select: { slug: true } },
      },
    });
    if (!job) return;
    const to = { email: job.customer.email, phone: job.customer.phone };
    const entity = { type: "Job", id: job.id };
    const name = job.customer.name.split(" ")[0] ?? job.customer.name;
    const technician = job.technician?.name.split(" ")[0] ?? null;
    const service = job.serviceType.name;
    const message = p.message;

    switch (message) {
      case "scheduled":
        return this.notify.toCustomer(
          to,
          "job.scheduled",
          {
            name,
            service,
            // The time from the event, so a confirmation always matches the change that caused it.
            when: formatWhen(p.scheduledStart!, this.config),
            technician,
            statusUrl: job.bookingToken
              ? bookingStatusUrl(this.env, job.organization.slug, job.bookingToken)
              : null,
          },
          { entity, dedupeKey: `job-scheduled:${job.id}:${p.scheduledStart}:${p.technicianId}` },
        );
      case "en_route":
        return this.notify.toCustomer(
          to,
          "job.en_route",
          { name, technician },
          { entity, dedupeKey: `job-en-route:${job.id}` },
        );
      case "completed":
        return this.notify.toCustomer(
          to,
          "job.completed",
          { name, service },
          { entity, dedupeKey: `job-completed:${job.id}` },
        );
      case "cancelled":
        return this.notify.toCustomer(
          to,
          "job.cancelled",
          { name, service, when: job.scheduledStart ? formatWhen(job.scheduledStart, this.config) : null },
          { entity, dedupeKey: `job-cancelled:${job.id}` },
        );
    }
  }

  /** Which customer message (if any) this change warrants. */
  private pick(e: JobChanged): JobMessage["message"] | null {
    const j = e.job;
    if (
      j.status === "SCHEDULED" &&
      j.technician &&
      j.scheduledStart &&
      e.kind !== "media" &&
      e.kind !== "parts"
    )
      return "scheduled";
    if (e.kind !== "status_changed") return null;
    if (j.status === "EN_ROUTE") return "en_route";
    if (j.status === "COMPLETED") return "completed";
    if (j.status === "CANCELLED") return "cancelled";
    return null;
  }
}
