import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ClientConfig } from "@opsdesk/config";
import { tenantContext } from "@opsdesk/db";
import { formatMoney, OPEN_INVOICE_STATUSES } from "@opsdesk/shared";
import { AuditService } from "../audit/audit.service";
import { CLIENT_CONFIG } from "../config/config.module";
import { ENV, type Env } from "../config/env";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { SystemLookupService } from "../system/system-lookup.service";
import { publicInvoiceUrl } from "./billing-mapping";

const DAY_MS = 86_400_000;

/**
 * Overdue reminders. Scheduled hourly, but each invoice gets at most one email
 * per `reminderIntervalDays` and at most `maxReminders` in total: the schedule
 * is a heartbeat, the rules live in the data. So a missed run, a double run or
 * two workers racing can't spam a customer.
 */
@Injectable()
export class RemindersService implements OnModuleInit {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly lookup: SystemLookupService,
    private readonly notify: NotificationService,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.queue.register("invoices.overdue-reminders", async () => {
      await this.runAll();
    });
  }

  /** Every organization (one per deployment today; the tenancy layer keeps it honest). */
  async runAll(now = new Date()): Promise<number> {
    let sent = 0;
    for (const organizationId of await this.lookup.allOrganizationIds())
      sent += await tenantContext.runAsync({ organizationId }, () => this.runForTenant(now));
    return sent;
  }

  async runForTenant(now: Date): Promise<number> {
    const { reminderIntervalDays, maxReminders } = this.config.invoicing;
    if (maxReminders === 0) return 0;
    const cutoff = new Date(now.getTime() - reminderIntervalDays * DAY_MS);

    const due = await this.prisma.db.invoice.findMany({
      where: {
        status: { in: [...OPEN_INVOICE_STATUSES] },
        dueDate: { lt: now },
        reminderCount: { lt: maxReminders },
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: cutoff } }],
      },
      include: { customer: { select: { name: true, email: true, phone: true } } },
      take: 500,
    });

    let sent = 0;
    for (const inv of due) {
      // Claim first (compare-and-swap on the count we read): only one runner sends each reminder.
      const claimed = await this.prisma.db.invoice.updateMany({
        where: { id: inv.id, reminderCount: inv.reminderCount, status: { in: [...OPEN_INVOICE_STATUSES] } },
        data: { reminderCount: { increment: 1 }, lastReminderAt: now },
      });
      if (claimed.count === 0) continue;

      const b = this.config.business;
      const daysLate = Math.max(1, Math.floor((now.getTime() - inv.dueDate.getTime()) / DAY_MS));
      const n = inv.reminderCount + 1;
      // Claimed above (only one runner gets here per reminder); the notification itself is
      // queued with a per-reminder dedupe key and retried by the worker until delivered.
      await this.notify.toCustomer(
        { email: inv.customer.email, phone: inv.customer.phone },
        "invoice.overdue",
        {
          name: inv.customer.name,
          number: inv.number,
          balance: formatMoney(inv.totalMinor - inv.amountPaidMinor, inv.currency, b.locale),
          daysLate,
          url: publicInvoiceUrl(this.env.APP_URL, inv.publicToken),
        },
        { entity: { type: "Invoice", id: inv.id }, dedupeKey: `invoice-overdue:${inv.id}:${n}` },
      );
      sent++;
      await this.audit.record({
        action: "invoice.reminder_sent",
        entityType: "Invoice",
        entityId: inv.id,
        after: { reminder: n, daysLate },
        actorType: "SYSTEM",
      });
    }
    if (sent) this.logger.log(`Sent ${sent} overdue reminder(s)`);
    return sent;
  }
}
