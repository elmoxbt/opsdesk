import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ClientConfig } from "@opsdesk/config";
import { currentOrganizationId, type NotificationChannel, Prisma, tenantContext } from "@opsdesk/db";
import type { NotificationDto } from "@opsdesk/shared";
import { iso, isoOrNull } from "../common/mapping";
import { CLIENT_CONFIG } from "../config/config.module";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { MAIL_PROVIDER, type MailProvider } from "./mail.provider";
import { type MessagingProvider, SMS_PROVIDER, WHATSAPP_PROVIDER } from "./messaging.provider";
import { type TemplateData, type TemplateName, templates } from "./templates";

/** Delivery attempts before a message is marked FAILED (the queue backs off between them). */
export const MAX_ATTEMPTS = 5;

export interface Recipient {
  email?: string | null;
  phone?: string | null;
}

export interface NotifyOptions {
  /** What it's about: shown under "messages" on that record. */
  entity?: { type: string; id: string };
  /**
   * Idempotency: the same key (per channel) is sent at most once, whatever
   * retries, double clicks or racing events happen. Omit for deliberate
   * repeats (e.g. "resend invoice").
   */
  dedupeKey?: string;
}

/**
 * The single way the app talks to people. It decides WHAT to send and to whom
 * (template, channels, dedupe) and records it; delivery happens in the
 * background with retries, so a slow or failing SMS gateway never fails or
 * slows the request that caused the message. Every attempt is logged.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: MessagingProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: MessagingProvider,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
  ) {}

  onModuleInit(): void {
    this.queue.register("notification.deliver", (p) =>
      tenantContext.runAsync({ organizationId: p.organizationId }, () => this.deliver(p.notificationId)),
    );
  }

  /** A customer: every channel this business has switched on that we have contact details for. */
  async toCustomer<T extends TemplateName>(
    to: Recipient,
    template: T,
    data: TemplateData<T>,
    opts: NotifyOptions = {},
  ): Promise<void> {
    const c = this.config.notifications;
    const channels: Array<[NotificationChannel, string]> = [];
    if (c.email && to.email) channels.push(["EMAIL", to.email]);
    if (c.sms && to.phone) channels.push(["SMS", to.phone]);
    if (c.whatsapp && to.phone) channels.push(["WHATSAPP", to.phone]);
    await this.create(channels, template, data, opts);
  }

  /** Office staff (owners and dispatchers), by email. */
  async toManagers<T extends TemplateName>(
    template: T,
    data: TemplateData<T>,
    opts: NotifyOptions = {},
  ): Promise<void> {
    const managers = await this.prisma.db.user.findMany({
      where: { isActive: true, role: { in: ["OWNER", "DISPATCHER"] } },
      select: { email: true },
    });
    await this.create(
      managers.map((m): [NotificationChannel, string] => ["EMAIL", m.email]),
      template,
      data,
      opts,
      true,
    );
  }

  async listFor(entityType: string, entityId: string): Promise<NotificationDto[]> {
    const rows = await this.prisma.db.notification.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((n) => ({
      id: n.id,
      channel: n.channel,
      recipient: n.recipient,
      template: n.template,
      subject: n.subject,
      body: n.body,
      status: n.status,
      attempts: n.attempts,
      error: n.error,
      sentAt: isoOrNull(n.sentAt),
      createdAt: iso(n.createdAt),
    }));
  }

  // ---------------------------------------------------------------------------

  private async create<T extends TemplateName>(
    channels: Array<[NotificationChannel, string]>,
    template: T,
    data: TemplateData<T>,
    opts: NotifyOptions,
    perRecipientKey = false,
  ): Promise<void> {
    const render = templates[template] as (c: TemplateData<T> & { business: string }) => {
      subject: string;
      text: string;
      short: string;
    };
    const r = render({ ...data, business: this.config.business.name });
    for (const [channel, recipient] of channels) {
      const email = channel === "EMAIL";
      try {
        const row = await this.prisma.db.notification.create({
          data: {
            organizationId: currentOrganizationId(),
            channel,
            recipient,
            template,
            subject: email ? r.subject : null,
            body: email ? r.text : r.short,
            entityType: opts.entity?.type,
            entityId: opts.entity?.id,
            dedupeKey: opts.dedupeKey
              ? `${opts.dedupeKey}:${channel}${perRecipientKey ? `:${recipient}` : ""}`
              : null,
          },
        });
        await this.queue.enqueue(
          "notification.deliver",
          { organizationId: row.organizationId, notificationId: row.id },
          { jobId: `notif-${row.id}` },
        );
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // already sent
        // Never fail the caller (a booking, a status change) because a message couldn't be queued.
        this.logger.error(`Could not queue ${template} via ${channel}: ${String(e)}`);
      }
    }
  }

  /**
   * Runs in the worker. Safe to repeat: only QUEUED rows are sent, and the
   * final update is conditional. Throws to make the queue retry with backoff;
   * gives up (FAILED, error kept) after MAX_ATTEMPTS.
   */
  async deliver(id: string): Promise<void> {
    const n = await this.prisma.db.notification.findUnique({ where: { id } });
    if (!n || n.status !== "QUEUED") return;
    const attempts = n.attempts + 1;
    try {
      if (n.channel === "EMAIL")
        await this.mail.send({ to: n.recipient, subject: n.subject ?? "", text: n.body });
      else await (n.channel === "SMS" ? this.sms : this.whatsapp).send({ to: n.recipient, text: n.body });
    } catch (e) {
      const giveUp = attempts >= MAX_ATTEMPTS;
      await this.prisma.db.notification.updateMany({
        where: { id, status: "QUEUED" },
        data: { attempts, error: String(e).slice(0, 500), ...(giveUp ? { status: "FAILED" } : {}) },
      });
      if (giveUp) {
        this.logger.error(`${n.template} via ${n.channel} to ${n.recipient} failed for good: ${String(e)}`);
        return;
      }
      throw e;
    }
    await this.prisma.db.notification.updateMany({
      where: { id, status: "QUEUED" },
      data: { status: "SENT", attempts, sentAt: new Date(), error: null },
    });
  }
}
