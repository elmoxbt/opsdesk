import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { currentOrganizationId, Prisma, tenantContext } from "@opsdesk/db";
import type { CheckoutDto } from "@opsdesk/shared";
import { AuditService } from "../audit/audit.service";
import { publicInvoiceUrl } from "../billing/billing-mapping";
import { InvoicesService } from "../billing/invoices.service";
import { PaymentLedger, type SettleOutcome } from "../billing/payment-ledger.service";
import { AppException } from "../common/app-exception";
import { ENV, type Env } from "../config/env";
import { PrismaService, type TenantTx } from "../prisma/prisma.service";
import { SystemLookupService } from "../system/system-lookup.service";
import { type ChargeResult, PAYMENT_GATEWAY, type PaymentGateway } from "./payment-provider";

/** A started-but-unfinished checkout younger than this is reused instead of creating another. */
const REUSE_PENDING_MS = 30 * 60_000;

export type WebhookResult = "processed" | "duplicate" | "ignored";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly ledger: PaymentLedger,
    private readonly audit: AuditService,
    private readonly lookup: SystemLookupService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * "Pay now" on the public page. Always the full balance. Retry-safe: pressing
   * it twice (or a flaky network replaying the POST) returns the same pending
   * checkout instead of opening a second charge.
   */
  async startCheckout(token: string, email: string): Promise<CheckoutDto> {
    const inv = await this.invoices.findByToken(token);
    const balance = inv.totalMinor - inv.amountPaidMinor;
    if (inv.status === "VOID") throw new AppException("CONFLICT", "This invoice was cancelled");
    if (balance <= 0) throw new AppException("CONFLICT", "This invoice is already paid");

    const pending = await this.prisma.db.payment.findFirst({
      where: {
        invoiceId: inv.id,
        provider: this.gateway.provider,
        status: "PENDING",
        amountMinor: balance,
        payerEmail: email,
        checkoutUrl: { not: null },
        createdAt: { gt: new Date(Date.now() - REUSE_PENDING_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (pending?.checkoutUrl) return { authorizationUrl: pending.checkoutUrl, reference: pending.reference };

    // Record the attempt BEFORE calling the gateway: a webhook can never arrive for a reference we don't know.
    const reference = `ops_${randomUUID().replace(/-/g, "")}`;
    const payment = await this.prisma.db.payment.create({
      data: {
        organizationId: currentOrganizationId(),
        invoiceId: inv.id,
        provider: this.gateway.provider,
        reference,
        amountMinor: balance,
        currency: inv.currency,
        idempotencyKey: reference,
        payerEmail: email,
      },
    });
    try {
      const { authorizationUrl } = await this.gateway.initialize({
        reference,
        amountMinor: balance,
        currency: inv.currency,
        email,
        callbackUrl: publicInvoiceUrl(this.env.APP_URL, inv.publicToken),
        metadata: { invoice: inv.number, organizationId: inv.organizationId },
      });
      await this.prisma.db.payment.update({
        where: { id: payment.id },
        data: { checkoutUrl: authorizationUrl },
      });
      return { authorizationUrl, reference };
    } catch (e) {
      await this.prisma.db.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      this.logger.error(`Checkout for ${inv.number} failed: ${String(e)}`);
      throw new AppException("INTERNAL", "We couldn't reach the payment provider. Please try again.");
    }
  }

  /**
   * The payer is back from checkout. Ask the gateway directly (server to server)
   * instead of trusting the redirect: the webhook may be seconds behind, and the
   * page shouldn't say "unpaid" to someone who just paid.
   */
  async verifyReturn(token: string, reference: string): Promise<void> {
    const inv = await this.invoices.findByToken(token);
    const payment = await this.prisma.db.payment.findFirst({
      where: { reference, invoiceId: inv.id, provider: this.gateway.provider },
    });
    if (!payment) throw new AppException("NOT_FOUND", "Payment not found");
    if (payment.status !== "PENDING") return;
    const charge = await this.gateway.verify(reference);
    if (charge) await this.applyCharge(charge);
  }

  /**
   * Webhook pipeline:
   *  1. signature over the raw body (the gateway throws if it's wrong) → 401;
   *  2. find the tenant from OUR reference (unknown → acknowledged and ignored,
   *     e.g. a charge from another app on the same Paystack account);
   *  3. in ONE transaction: insert the event id (unique) and apply the charge.
   * A duplicate delivery hits the unique index and is a no-op. A failure rolls
   * back the event row too, we answer 500, and the provider's retry runs it again.
   */
  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookResult> {
    const event = this.gateway.parseWebhook(rawBody, headers);
    if (!event.charge) return "ignored";
    const organizationId = await this.lookup.organizationForPayment(
      this.gateway.provider,
      event.charge.reference,
    );
    if (!organizationId) {
      this.logger.warn(`Webhook for unknown reference ${event.charge.reference}; ignored`);
      return "ignored";
    }
    return tenantContext.runAsync({ organizationId }, async () => {
      let outcome: SettleOutcome | null = null;
      try {
        outcome = await this.prisma.db.$transaction(async (tx) => {
          await tx.webhookEvent.create({
            data: {
              provider: this.gateway.provider,
              externalId: event.externalId,
              eventType: event.type,
              payload: event.raw as Prisma.InputJsonValue,
            },
          });
          return this.applyChargeIn(tx, event.charge!);
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
        throw e;
      }
      await this.ledger.afterCommit(this.prisma.db, outcome);
      return "processed";
    });
  }

  private async applyCharge(charge: ChargeResult): Promise<void> {
    const outcome = await this.prisma.db.$transaction((tx) => this.applyChargeIn(tx, charge));
    await this.ledger.afterCommit(this.prisma.db, outcome);
  }

  private async applyChargeIn(db: TenantTx, charge: ChargeResult): Promise<SettleOutcome | null> {
    const payment = await db.payment.findFirst({
      where: { provider: this.gateway.provider, reference: charge.reference },
    });
    if (!payment || payment.status !== "PENDING") return null;

    if (charge.status === "failed") {
      await db.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED" },
      });
      return null;
    }
    if (charge.status !== "success") return null;

    // Never trust the event's amount blindly: it must be exactly what we asked for, in our currency.
    if (charge.amountMinor !== payment.amountMinor || charge.currency !== payment.currency) {
      this.logger.error(
        `Amount mismatch on ${payment.reference}: expected ${payment.amountMinor} ${payment.currency}, got ${charge.amountMinor} ${charge.currency}`,
      );
      await this.audit.record(
        {
          action: "payment.amount_mismatch",
          entityType: "Payment",
          entityId: payment.id,
          after: { expected: payment.amountMinor, received: charge.amountMinor, currency: charge.currency },
          actorType: "SYSTEM",
        },
        db,
      );
      return null;
    }
    return this.ledger.settle(db, payment.id, {
      paidAt: charge.paidAt ?? new Date(),
      rawPayload: charge.raw as Prisma.InputJsonValue,
    });
  }
}
