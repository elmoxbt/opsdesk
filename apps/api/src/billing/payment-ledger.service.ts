import { Injectable, Logger } from "@nestjs/common";
import { currentOrganizationId, type Prisma, type TenantPrismaClient } from "@opsdesk/db";
import { AuditService } from "../audit/audit.service";
import { toJobDto, jobInclude } from "../jobs/jobs.service";
import type { TenantTx } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { DomainEvents } from "../realtime/domain-events";

type Tx = TenantTx;

export interface SettleOutcome {
  invoiceId: string;
  pdfVersion: number;
  jobId: string | null;
  event: {
    invoiceId: string;
    number: string;
    customerName: string;
    amountMinor: number;
    currency: string;
    fullyPaid: boolean;
    firstEver: boolean;
  };
}

/**
 * The one place money is applied to an invoice, whichever way it arrived
 * (Paystack webhook, the payer returning from checkout, a manual entry).
 *
 * `settle` runs inside the caller's transaction and is idempotent: the payment
 * moves PENDING → SUCCEEDED with a conditional update, so a webhook retry, a
 * duplicate delivery and the "verify on return" call racing each other apply
 * the money exactly once. Whoever loses the race gets `null`.
 */
@Injectable()
export class PaymentLedger {
  private readonly logger = new Logger(PaymentLedger.name);

  constructor(
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly events: DomainEvents,
  ) {}

  async settle(
    tx: Tx,
    paymentId: string,
    opts: { paidAt?: Date; rawPayload?: Prisma.InputJsonValue; actorId?: string } = {},
  ): Promise<SettleOutcome | null> {
    const paidAt = opts.paidAt ?? new Date();
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "SUCCEEDED", paidAt, ...(opts.rawPayload ? { rawPayload: opts.rawPayload } : {}) },
    });
    if (claimed.count === 0) return null; // already applied (or failed): nothing to do

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    // The increment takes the invoice row lock: concurrent payments on one invoice serialize here.
    const inv = await tx.invoice.update({
      where: { id: payment.invoiceId },
      data: { amountPaidMinor: { increment: payment.amountMinor } },
      include: { customer: { select: { name: true } } },
    });

    const fullyPaid = inv.amountPaidMinor >= inv.totalMinor;
    let pdfVersion = inv.pdfVersion;
    if (inv.status === "VOID") {
      // Money for a voided invoice (e.g. paid from an old link): keep it, keep VOID, and make it visible.
      this.logger.warn(
        `Payment ${payment.id} received on void invoice ${inv.number}; needs a refund decision`,
      );
    } else {
      const updated = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
          paidAt: fullyPaid ? paidAt : null,
          pdfVersion: { increment: 1 }, // re-render with the PAID stamp / new balance
        },
        select: { pdfVersion: true },
      });
      pdfVersion = updated.pdfVersion;
    }

    let jobId: string | null = null;
    if (fullyPaid && inv.jobId) {
      const moved = await tx.job.updateMany({
        where: { id: inv.jobId, status: { in: ["COMPLETED", "INVOICED"] } },
        data: { status: "PAID", version: { increment: 1 } },
      });
      if (moved.count === 1) {
        jobId = inv.jobId;
        await this.audit.record(
          {
            action: "job.status_changed",
            entityType: "Job",
            entityId: inv.jobId,
            after: { status: "PAID", invoice: inv.number },
            actorType: "SYSTEM",
            actorId: undefined,
          },
          tx,
        );
      }
    }

    await this.audit.record(
      {
        action: "invoice.payment_received",
        entityType: "Invoice",
        entityId: inv.id,
        after: {
          paymentId: payment.id,
          provider: payment.provider,
          amountMinor: payment.amountMinor,
          amountPaidMinor: inv.amountPaidMinor,
          status: inv.status === "VOID" ? "VOID" : fullyPaid ? "PAID" : "PARTIALLY_PAID",
        },
        ...(opts.actorId
          ? { actorId: opts.actorId }
          : { actorType: payment.provider === "MANUAL" ? undefined : "SYSTEM" }),
      },
      tx,
    );

    // "First ever paid invoice" for the celebration: this one is now PAID and no other is.
    const firstEver =
      fullyPaid && inv.status !== "VOID"
        ? (await tx.invoice.count({ where: { status: "PAID", id: { not: inv.id } } })) === 0
        : false;

    return {
      invoiceId: inv.id,
      pdfVersion,
      jobId,
      event: {
        invoiceId: inv.id,
        number: inv.number,
        customerName: inv.customer.name,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        fullyPaid,
        firstEver,
      },
    };
  }

  /** Side effects AFTER the transaction commits: never announce money that rolled back. */
  async afterCommit(db: TenantPrismaClient, outcome: SettleOutcome | null): Promise<void> {
    if (!outcome) return;
    const organizationId = currentOrganizationId();
    await this.queue.enqueue(
      "invoice.render-pdf",
      { organizationId, invoiceId: outcome.invoiceId, version: outcome.pdfVersion },
      { jobId: `pdf-${outcome.invoiceId}-v${outcome.pdfVersion}` },
    );
    this.events.publish({ type: "invoice.paid", organizationId, event: outcome.event });
    if (outcome.jobId) {
      const job = await db.job.findUnique({ where: { id: outcome.jobId }, include: jobInclude });
      if (job)
        this.events.publish({
          type: "job.changed",
          organizationId,
          kind: "status_changed",
          job: toJobDto(job),
          previousTechnicianId: null,
          actorId: null,
        });
    }
  }
}
