import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ClientConfig } from "@opsdesk/config";
import { currentOrganizationId, Prisma, tenantContext } from "@opsdesk/db";
import {
  computeTotals,
  formatInvoiceNumber,
  formatJobNumber,
  formatMoney,
  type InvoiceDto,
  invoiceInputSchema,
  type InvoiceSummaryDto,
  manualPaymentSchema,
  OPEN_INVOICE_STATUSES,
  type Paginated,
  type PublicInvoiceDto,
  zonedDateKey,
  zonedDayRange,
} from "@opsdesk/shared";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { AppException } from "../common/app-exception";
import { invalidField, pageArgs } from "../common/mapping";
import { CLIENT_CONFIG } from "../config/config.module";
import { ENV, type Env } from "../config/env";
import { jobInclude, toJobDto } from "../jobs/jobs.service";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService, type TenantTx } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { DomainEvents } from "../realtime/domain-events";
import { StorageService } from "../storage/storage.service";
import {
  addDaysKey,
  endOfZonedDay,
  invoiceInclude,
  publicInvoiceUrl,
  toInvoiceDto,
  type InvoiceRow,
} from "./billing-mapping";
import { renderInvoicePdf } from "./invoice-pdf";
import { PaymentLedger } from "./payment-ledger.service";

type Tx = TenantTx;
type InvoiceData = z.output<typeof invoiceInputSchema>;
type ManualPayment = z.output<typeof manualPaymentSchema>;

export interface InvoiceListQuery {
  page: number;
  pageSize: number;
  q?: string;
  status?: InvoiceDto["displayStatus"];
  customerId?: string;
  jobId?: string;
}

const lineRows = (items: InvoiceData["lineItems"], totals: { lines: Array<{ totalMinor: number }> }) =>
  items.map((l, position) => ({
    organizationId: currentOrganizationId(),
    description: l.description,
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor,
    totalMinor: totals.lines[position]!.totalMinor,
    position,
  }));

/**
 * Invoices: drafts, issuing (number → PDF job → email with the pay link),
 * voiding, manual payments, and the public view. Online payment lives in the
 * optional PaymentsModule and reuses PaymentLedger, so money is applied in one place.
 */
@Injectable()
export class InvoicesService implements OnModuleInit {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly ledger: PaymentLedger,
    private readonly events: DomainEvents,
    private readonly notify: NotificationService,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.queue.register("invoice.render-pdf", (p) =>
      tenantContext.runAsync({ organizationId: p.organizationId }, () =>
        this.renderPdf(p.invoiceId, p.version),
      ),
    );
  }

  private get tz(): string {
    return this.config.business.timezone;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async list(q: InvoiceListQuery): Promise<Paginated<InvoiceDto>> {
    const now = new Date();
    const where: Prisma.InvoiceWhereInput = {
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: "insensitive" } },
              { customer: { name: { contains: q.q, mode: "insensitive" } } },
            ],
          }
        : {}),
      // OVERDUE is derived, so filtering by it is a date query, not a status match.
      ...(q.status === "OVERDUE"
        ? { status: { in: [...OPEN_INVOICE_STATUSES] }, dueDate: { lt: now } }
        : q.status === "SENT" || q.status === "PARTIALLY_PAID"
          ? { status: q.status, dueDate: { gte: now } }
          : q.status
            ? { status: q.status }
            : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.invoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(q),
      }),
      this.prisma.db.invoice.count({ where }),
    ]);
    return { items: rows.map((r) => this.dto(r, now)), page: q.page, pageSize: q.pageSize, total };
  }

  async get(id: string): Promise<InvoiceDto> {
    return this.dto(await this.find(this.prisma.db, id));
  }

  async summary(): Promise<InvoiceSummaryDto> {
    const now = new Date();
    const open = { status: { in: [...OPEN_INVOICE_STATUSES] } } satisfies Prisma.InvoiceWhereInput;
    const [y, m] = zonedDateKey(now, this.tz).split("-").map(Number) as [number, number];
    const monthStart = zonedDayRange(new Date(Date.UTC(y, m - 1, 1, 12)), this.tz).start;
    const [outstanding, overdue, paid] = await Promise.all([
      this.prisma.db.invoice.aggregate({ where: open, _sum: { totalMinor: true, amountPaidMinor: true } }),
      this.prisma.db.invoice.aggregate({
        where: { ...open, dueDate: { lt: now } },
        _sum: { totalMinor: true, amountPaidMinor: true },
        _count: true,
      }),
      this.prisma.db.payment.aggregate({
        where: { status: "SUCCEEDED", paidAt: { gte: monthStart } },
        _sum: { amountMinor: true },
      }),
    ]);
    const owed = (a: { _sum: { totalMinor: number | null; amountPaidMinor: number | null } }) =>
      (a._sum.totalMinor ?? 0) - (a._sum.amountPaidMinor ?? 0);
    return {
      outstandingMinor: owed(outstanding),
      overdueMinor: owed(overdue),
      overdueCount: overdue._count,
      paidThisMonthMinor: paid._sum.amountMinor ?? 0,
      currency: this.config.business.currency,
    };
  }

  // ---------------------------------------------------------------------------
  // Drafts
  // ---------------------------------------------------------------------------

  async create(data: InvoiceData): Promise<InvoiceDto> {
    return this.dto(
      await this.prisma.db.$transaction(async (tx) => {
        const inv = await this.insertDraft(tx, data);
        await this.audit.record(
          {
            action: "invoice.created",
            entityType: "Invoice",
            entityId: inv.id,
            after: { number: inv.number, totalMinor: inv.totalMinor },
          },
          tx,
        );
        return inv;
      }),
    );
  }

  /** Shared by "new invoice", "invoice this job" and "convert quote". Caller audits. */
  async insertDraft(
    tx: Tx,
    data: InvoiceData,
    links: { jobId?: string; quoteId?: string } = {},
  ): Promise<InvoiceRow> {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId }, select: { id: true } });
    if (!customer) throw invalidField("customerId", "Customer not found");

    const taxRateBps = data.taxRateBps ?? this.config.business.taxRateBps;
    const totals = computeTotals(data.lineItems, taxRateBps);
    const today = zonedDateKey(new Date(), this.tz);
    const dueKey = data.dueDate ?? addDaysKey(today, this.config.invoicing.paymentTermsDays);
    if (dueKey < today) throw invalidField("dueDate", "Due date can't be in the past");

    // Row-locking increment (like job numbers): no gaps from races, no duplicates.
    const { invoiceSeq } = await tx.organization.update({
      where: { id: currentOrganizationId() },
      data: { invoiceSeq: { increment: 1 } },
      select: { invoiceSeq: true },
    });
    try {
      const inv = await tx.invoice.create({
        data: {
          organizationId: currentOrganizationId(),
          number: formatInvoiceNumber(invoiceSeq),
          customerId: data.customerId,
          jobId: links.jobId,
          quoteId: links.quoteId,
          currency: this.config.business.currency,
          taxRateBps,
          subtotalMinor: totals.subtotalMinor,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          dueDate: endOfZonedDay(dueKey, this.tz),
          publicToken: randomBytes(24).toString("base64url"),
          notes: data.notes,
        },
      });
      await tx.invoiceLineItem.createMany({
        data: lineRows(data.lineItems, totals).map((l) => ({ ...l, invoiceId: inv.id })),
      });
      return await this.find(tx, inv.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = String((e.meta?.target as string[] | undefined) ?? "");
        if (target.includes("jobId")) throw new AppException("CONFLICT", "This job already has an invoice");
        if (target.includes("quoteId"))
          throw new AppException("CONFLICT", "This quote was already converted");
      }
      throw e;
    }
  }

  /**
   * Builds a draft from a completed job: the service at the job's price, plus
   * every part used (unit cost + the configured markup). Staff review it, then issue.
   */
  async fromJob(jobId: string): Promise<InvoiceDto> {
    return this.dto(
      await this.prisma.db.$transaction(async (tx) => {
        const job = await tx.job.findUnique({
          where: { id: jobId },
          include: {
            serviceType: { select: { name: true, defaultPriceMinor: true } },
            parts: {
              include: { inventoryItem: { select: { name: true, sku: true } } },
              orderBy: { createdAt: "asc" },
            },
            invoice: { select: { id: true, number: true } },
          },
        });
        if (!job) throw new AppException("NOT_FOUND", "Job not found");
        if (job.invoice) throw new AppException("CONFLICT", `This job is already on ${job.invoice.number}`);
        if (job.status !== "COMPLETED")
          throw new AppException("CONFLICT", "Only completed jobs can be invoiced");

        const markup = this.config.invoicing.partsMarkupBps;
        const lineItems = [
          {
            description: `${job.serviceType.name} (${formatJobNumber(job.number)})`,
            quantity: 1,
            unitPriceMinor: job.priceMinor ?? job.serviceType.defaultPriceMinor,
          },
          ...job.parts.map((p) => ({
            description: `${p.inventoryItem.name} (${p.inventoryItem.sku})`,
            quantity: p.quantity,
            unitPriceMinor: Math.round((p.unitCostMinor * (10_000 + markup)) / 10_000),
          })),
        ];
        const inv = await this.insertDraft(
          tx,
          { customerId: job.customerId, lineItems, notes: null, dueDate: null, taxRateBps: undefined },
          { jobId: job.id },
        );
        await this.audit.record(
          {
            action: "invoice.created",
            entityType: "Invoice",
            entityId: inv.id,
            after: { number: inv.number, fromJob: formatJobNumber(job.number), totalMinor: inv.totalMinor },
          },
          tx,
        );
        return inv;
      }),
    );
  }

  /** Drafts only: once issued, an invoice is a legal document; correct it by voiding and reissuing. */
  async update(id: string, data: InvoiceData): Promise<InvoiceDto> {
    return this.dto(
      await this.prisma.db.$transaction(async (tx) => {
        const before = await this.find(tx, id);
        if (before.status !== "DRAFT")
          throw new AppException("CONFLICT", "Only draft invoices can be edited");
        if (data.customerId !== before.customerId && before.jobId)
          throw invalidField("customerId", "An invoice for a job must bill that job's customer");
        const customer = await tx.customer.findUnique({
          where: { id: data.customerId },
          select: { id: true },
        });
        if (!customer) throw invalidField("customerId", "Customer not found");

        const taxRateBps = data.taxRateBps ?? before.taxRateBps;
        const totals = computeTotals(data.lineItems, taxRateBps);
        const dueDate = data.dueDate ? endOfZonedDay(data.dueDate, this.tz) : before.dueDate;
        const res = await tx.invoice.updateMany({
          where: { id, status: "DRAFT" },
          data: {
            customerId: data.customerId,
            taxRateBps,
            subtotalMinor: totals.subtotalMinor,
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            dueDate,
            notes: data.notes,
          },
        });
        if (res.count === 0) throw new AppException("CONFLICT", "This invoice was issued meanwhile. Reload.");
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceLineItem.createMany({
          data: lineRows(data.lineItems, totals).map((l) => ({ ...l, invoiceId: id })),
        });
        await this.audit.record(
          {
            action: "invoice.updated",
            entityType: "Invoice",
            entityId: id,
            before: { totalMinor: before.totalMinor, lines: before.lineItems.length },
            after: { totalMinor: totals.totalMinor, lines: data.lineItems.length },
          },
          tx,
        );
        return this.find(tx, id);
      }),
    );
  }

  async deleteDraft(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const inv = await this.find(tx, id);
      if (inv.status !== "DRAFT")
        throw new AppException("CONFLICT", "Only drafts can be deleted; void it instead");
      await tx.invoice.deleteMany({ where: { id, status: "DRAFT" } });
      await this.audit.record(
        { action: "invoice.deleted", entityType: "Invoice", entityId: id, before: { number: inv.number } },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * DRAFT → SENT. In one transaction: status, the job moves to INVOICED, the PDF
   * version is bumped. After commit: the PDF job is queued and the customer is
   * emailed the pay link (the link works before the PDF exists).
   */
  async issue(id: string): Promise<InvoiceDto> {
    let movedJobId: string | null = null;
    const inv = await this.prisma.db.$transaction(async (tx) => {
      const before = await this.find(tx, id);
      if (before.status !== "DRAFT") throw new AppException("CONFLICT", "This invoice was already issued");
      if (before.totalMinor <= 0) throw new AppException("BAD_REQUEST", "Can't issue an invoice for nothing");
      const res = await tx.invoice.updateMany({
        where: { id, status: "DRAFT" },
        data: { status: "SENT", sentAt: new Date(), issueDate: new Date(), pdfVersion: { increment: 1 } },
      });
      if (res.count === 0) throw new AppException("CONFLICT", "This invoice was already issued");
      if (before.jobId) {
        const moved = await tx.job.updateMany({
          where: { id: before.jobId, status: "COMPLETED" },
          data: { status: "INVOICED", version: { increment: 1 } },
        });
        if (moved.count === 1) {
          movedJobId = before.jobId;
          await this.audit.record(
            {
              action: "job.status_changed",
              entityType: "Job",
              entityId: before.jobId,
              before: { status: "COMPLETED" },
              after: { status: "INVOICED", invoice: before.number },
            },
            tx,
          );
        }
      }
      await this.audit.record(
        { action: "invoice.issued", entityType: "Invoice", entityId: id, after: { number: before.number } },
        tx,
      );
      return this.find(tx, id);
    });

    await this.enqueuePdf(inv);
    if (movedJobId) await this.publishJob(movedJobId);
    await this.emailInvoice(inv);
    return this.dto(inv);
  }

  /** Resend the email (e.g. the customer lost it). */
  async resend(id: string): Promise<InvoiceDto> {
    const inv = await this.find(this.prisma.db, id);
    if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(inv.status))
      throw new AppException("CONFLICT", "Only unpaid, issued invoices can be sent");
    if (!inv.customer.email) throw new AppException("BAD_REQUEST", "This customer has no email address");
    await this.emailInvoice(inv, true);
    await this.audit.record({ action: "invoice.sent", entityType: "Invoice", entityId: id });
    return this.dto(inv);
  }

  async void(id: string, reason: string): Promise<InvoiceDto> {
    const inv = await this.prisma.db.$transaction(async (tx) => {
      const before = await this.find(tx, id);
      if (before.status === "VOID") throw new AppException("CONFLICT", "Already void");
      if (before.amountPaidMinor > 0)
        throw new AppException("CONFLICT", "This invoice has payments; refund them before voiding");
      const res = await tx.invoice.updateMany({
        where: { id, status: before.status, amountPaidMinor: 0 },
        data: { status: "VOID", voidedAt: new Date(), voidReason: reason, pdfVersion: { increment: 1 } },
      });
      if (res.count === 0) throw new AppException("CONFLICT", "This invoice changed meanwhile. Reload.");
      // Free the job so it can be invoiced again (the unique jobId would otherwise block it).
      if (before.jobId) {
        await tx.invoice.update({ where: { id }, data: { jobId: null } });
        await tx.job.updateMany({
          where: { id: before.jobId, status: "INVOICED" },
          data: { status: "COMPLETED", version: { increment: 1 } },
        });
      }
      await this.audit.record(
        {
          action: "invoice.voided",
          entityType: "Invoice",
          entityId: id,
          before: { status: before.status },
          after: { status: "VOID", reason },
        },
        tx,
      );
      return { row: await this.find(tx, id), jobId: before.jobId };
    });
    if (inv.row.pdfVersion > 1 || inv.row.sentAt) await this.enqueuePdf(inv.row);
    if (inv.jobId) await this.publishJob(inv.jobId);
    return this.dto(inv.row);
  }

  /** Cash / transfer / POS recorded by staff. Uses the same ledger as online payments. */
  async recordManualPayment(id: string, input: ManualPayment, idempotencyKey?: string): Promise<InvoiceDto> {
    const outcome = await this.prisma.db.$transaction(async (tx) => {
      const inv = await this.find(tx, id);
      if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(inv.status))
        throw new AppException(
          "CONFLICT",
          inv.status === "DRAFT" ? "Issue the invoice first" : "Nothing is owed on this invoice",
        );
      const balance = inv.totalMinor - inv.amountPaidMinor;
      if (input.amountMinor > balance)
        throw invalidField(
          "amountMinor",
          `That's more than the balance (${formatMoney(balance, inv.currency)})`,
        );
      const payment = await tx.payment.create({
        data: {
          organizationId: currentOrganizationId(),
          invoiceId: id,
          provider: "MANUAL",
          reference: `manual_${randomUUID()}`,
          amountMinor: input.amountMinor,
          currency: inv.currency,
          idempotencyKey: idempotencyKey ?? randomUUID(),
          method: input.method,
          note: input.note,
        },
      });
      return this.ledger.settle(tx, payment.id, {
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      });
    });
    await this.ledger.afterCommit(this.prisma.db, outcome);
    return this.get(id);
  }

  async pdfUrl(id: string): Promise<{ url: string }> {
    return this.signedPdf(await this.find(this.prisma.db, id));
  }

  // ---------------------------------------------------------------------------
  // Public ("view & pay" link). Callers resolve the tenant from the token first.
  // ---------------------------------------------------------------------------

  async findByToken(token: string): Promise<InvoiceRow> {
    const inv = await this.prisma.db.invoice.findUnique({
      where: { publicToken: token },
      include: invoiceInclude,
    });
    // Drafts aren't public yet: same 404 as a wrong token.
    if (!inv || inv.status === "DRAFT") throw new AppException("NOT_FOUND", "Invoice not found");
    return inv;
  }

  toPublic(inv: InvoiceRow): PublicInvoiceDto {
    const d = this.dto(inv);
    const b = this.config.business;
    return {
      number: d.number,
      displayStatus: d.displayStatus,
      business: {
        name: b.name,
        email: b.email,
        phone: b.phone ?? null,
        address: b.address ?? null,
        logoUrl: this.config.branding.logoUrl ?? null,
      },
      customer: { name: d.customer.name, email: d.customer.email },
      currency: d.currency,
      subtotalMinor: d.subtotalMinor,
      taxRateBps: d.taxRateBps,
      taxMinor: d.taxMinor,
      totalMinor: d.totalMinor,
      amountPaidMinor: d.amountPaidMinor,
      balanceMinor: d.balanceMinor,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      paidAt: d.paidAt,
      notes: d.notes,
      lineItems: d.lineItems.map(({ id: _, ...l }) => l),
      canPayOnline: this.config.features.payments && d.balanceMinor > 0 && d.status !== "VOID",
      pdfReady: d.pdfReady,
    };
  }

  async publicPdfUrl(token: string): Promise<{ url: string }> {
    return this.signedPdf(await this.findByToken(token));
  }

  // ---------------------------------------------------------------------------
  // Background: PDF rendering
  // ---------------------------------------------------------------------------

  /**
   * Renders version `version` of an invoice's PDF to S3. Safe to retry and to
   * run out of order: a job for an outdated version does nothing, and the
   * final update only moves `pdfRenderedVersion` forward.
   */
  async renderPdf(invoiceId: string, version: number): Promise<void> {
    const inv = await this.prisma.db.invoice.findUnique({
      where: { id: invoiceId },
      include: invoiceInclude,
    });
    if (!inv || inv.pdfVersion !== version || inv.pdfRenderedVersion >= version) return;

    const b = this.config.business;
    const pdf = await renderInvoicePdf({
      business: {
        name: b.name,
        email: b.email,
        phone: b.phone,
        address: b.address,
        primaryColor: this.config.branding.primaryColor,
      },
      number: inv.number,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      customer: inv.customer,
      lineItems: inv.lineItems,
      subtotalMinor: inv.subtotalMinor,
      taxRateBps: inv.taxRateBps,
      taxMinor: inv.taxMinor,
      totalMinor: inv.totalMinor,
      amountPaidMinor: inv.amountPaidMinor,
      currency: inv.currency,
      locale: b.locale,
      timezone: b.timezone,
      notes: inv.notes,
      footer: this.config.invoicing.footer,
      payUrl: this.config.features.payments ? publicInvoiceUrl(this.env.APP_URL, inv.publicToken) : null,
    });
    // One object per version: a reader holding an old URL never sees a half-written file.
    const key = `${inv.organizationId}/invoices/${inv.id}/v${version}.pdf`;
    await this.storage.put(key, pdf, "application/pdf");
    await this.prisma.db.invoice.updateMany({
      where: { id: inv.id, pdfRenderedVersion: { lt: version } },
      data: { pdfS3Key: key, pdfRenderedVersion: version },
    });
    this.logger.log(`Rendered ${inv.number} v${version} (${pdf.length} bytes)`);
  }

  // ---------------------------------------------------------------------------

  private async signedPdf(inv: InvoiceRow): Promise<{ url: string }> {
    const ready = inv.pdfS3Key && inv.pdfVersion > 0 && inv.pdfRenderedVersion === inv.pdfVersion;
    if (!ready)
      throw new AppException("CONFLICT", "The PDF is still being generated. Try again in a moment.");
    return { url: await this.storage.presignGet(inv.pdfS3Key!, 300, `${inv.number}.pdf`) };
  }

  private enqueuePdf(inv: InvoiceRow): Promise<void> {
    return this.queue.enqueue(
      "invoice.render-pdf",
      { organizationId: inv.organizationId, invoiceId: inv.id, version: inv.pdfVersion },
      { jobId: `pdf-${inv.id}-v${inv.pdfVersion}` },
    );
  }

  /** Email/SMS/WhatsApp per the business's channels. `resend` deliberately skips the dedupe. */
  private async emailInvoice(inv: InvoiceRow, resend = false): Promise<void> {
    const b = this.config.business;
    await this.notify.toCustomer(
      { email: inv.customer.email, phone: inv.customer.phone },
      "invoice.issued",
      {
        name: inv.customer.name,
        number: inv.number,
        amount: formatMoney(inv.totalMinor - inv.amountPaidMinor, inv.currency, b.locale),
        due: new Intl.DateTimeFormat(b.locale, { dateStyle: "medium", timeZone: this.tz }).format(
          inv.dueDate,
        ),
        url: publicInvoiceUrl(this.env.APP_URL, inv.publicToken),
      },
      {
        entity: { type: "Invoice", id: inv.id },
        ...(resend ? {} : { dedupeKey: `invoice-issued:${inv.id}` }),
      },
    );
  }

  private async publishJob(jobId: string): Promise<void> {
    const job = await this.prisma.db.job.findUnique({ where: { id: jobId }, include: jobInclude });
    if (!job) return;
    this.events.publish({
      type: "job.changed",
      organizationId: currentOrganizationId(),
      kind: "status_changed",
      job: toJobDto(job),
      previousTechnicianId: null,
      actorId: tenantContext.get()?.userId ?? null,
    });
  }

  private async find(db: Pick<Tx, "invoice">, id: string): Promise<InvoiceRow> {
    const inv = await db.invoice.findUnique({ where: { id }, include: invoiceInclude });
    if (!inv) throw new AppException("NOT_FOUND", "Invoice not found");
    return inv;
  }

  private dto(row: InvoiceRow, now = new Date()): InvoiceDto {
    return toInvoiceDto(row, this.env.APP_URL, now);
  }
}
