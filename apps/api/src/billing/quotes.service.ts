import { Inject, Injectable } from "@nestjs/common";
import type { ClientConfig } from "@opsdesk/config";
import { currentOrganizationId, type Prisma } from "@opsdesk/db";
import {
  computeTotals,
  formatQuoteNumber,
  type InvoiceDto,
  type Paginated,
  QUOTE_TRANSITIONS,
  type QuoteDto,
  quoteInputSchema,
  type QuoteStatus,
  zonedDateKey,
} from "@opsdesk/shared";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { AppException } from "../common/app-exception";
import { invalidField, pageArgs } from "../common/mapping";
import { CLIENT_CONFIG } from "../config/config.module";
import { PrismaService, type TenantTx } from "../prisma/prisma.service";
import { addDaysKey, endOfZonedDay, quoteInclude, type QuoteRow, toQuoteDto } from "./billing-mapping";
import { InvoicesService } from "./invoices.service";

type Tx = TenantTx;
type QuoteData = z.output<typeof quoteInputSchema>;

export interface QuoteListQuery {
  page: number;
  pageSize: number;
  q?: string;
  status?: QuoteStatus;
}

/** Quotes: priced proposals. Accepted ones convert into a draft invoice with the same lines. */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
  ) {}

  async list(q: QuoteListQuery): Promise<Paginated<QuoteDto>> {
    const where: Prisma.QuoteWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: "insensitive" } },
              { customer: { name: { contains: q.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.quote.findMany({
        where,
        include: quoteInclude,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(q),
      }),
      this.prisma.db.quote.count({ where }),
    ]);
    return { items: rows.map(toQuoteDto), page: q.page, pageSize: q.pageSize, total };
  }

  async get(id: string): Promise<QuoteDto> {
    return toQuoteDto(await this.find(this.prisma.db, id));
  }

  async create(data: QuoteData): Promise<QuoteDto> {
    return toQuoteDto(
      await this.prisma.db.$transaction(async (tx) => {
        await this.validateRefs(tx, data);
        const taxRateBps = data.taxRateBps ?? this.config.business.taxRateBps;
        const totals = computeTotals(data.lineItems, taxRateBps);
        const { quoteSeq } = await tx.organization.update({
          where: { id: currentOrganizationId() },
          data: { quoteSeq: { increment: 1 } },
          select: { quoteSeq: true },
        });
        const quote = await tx.quote.create({
          data: {
            organizationId: currentOrganizationId(),
            number: formatQuoteNumber(quoteSeq),
            customerId: data.customerId,
            jobId: data.jobId ?? null,
            taxRateBps,
            subtotalMinor: totals.subtotalMinor,
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            validUntil: this.validUntil(data.validUntil),
            notes: data.notes,
          },
        });
        await this.writeLines(tx, quote.id, data.lineItems, totals);
        await this.audit.record(
          {
            action: "quote.created",
            entityType: "Quote",
            entityId: quote.id,
            after: { number: quote.number, totalMinor: quote.totalMinor },
          },
          tx,
        );
        return this.find(tx, quote.id);
      }),
    );
  }

  async update(id: string, data: QuoteData): Promise<QuoteDto> {
    return toQuoteDto(
      await this.prisma.db.$transaction(async (tx) => {
        const before = await this.find(tx, id);
        if (before.status !== "DRAFT") throw new AppException("CONFLICT", "Only draft quotes can be edited");
        await this.validateRefs(tx, data);
        const taxRateBps = data.taxRateBps ?? before.taxRateBps;
        const totals = computeTotals(data.lineItems, taxRateBps);
        const res = await tx.quote.updateMany({
          where: { id, status: "DRAFT" },
          data: {
            customerId: data.customerId,
            jobId: data.jobId ?? null,
            taxRateBps,
            subtotalMinor: totals.subtotalMinor,
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            validUntil: data.validUntil
              ? endOfZonedDay(data.validUntil, this.config.business.timezone)
              : before.validUntil,
            notes: data.notes,
          },
        });
        if (res.count === 0) throw new AppException("CONFLICT", "This quote changed meanwhile. Reload.");
        await tx.quoteLineItem.deleteMany({ where: { quoteId: id } });
        await this.writeLines(tx, id, data.lineItems, totals);
        await this.audit.record(
          {
            action: "quote.updated",
            entityType: "Quote",
            entityId: id,
            before: { totalMinor: before.totalMinor },
            after: { totalMinor: totals.totalMinor },
          },
          tx,
        );
        return this.find(tx, id);
      }),
    );
  }

  async setStatus(id: string, to: "SENT" | "ACCEPTED" | "DECLINED"): Promise<QuoteDto> {
    return toQuoteDto(
      await this.prisma.db.$transaction(async (tx) => {
        const before = await this.find(tx, id);
        if (!QUOTE_TRANSITIONS[before.status].includes(to))
          throw new AppException(
            "CONFLICT",
            `A ${before.status.toLowerCase()} quote can't be marked ${to.toLowerCase()}`,
          );
        const res = await tx.quote.updateMany({ where: { id, status: before.status }, data: { status: to } });
        if (res.count === 0) throw new AppException("CONFLICT", "This quote changed meanwhile. Reload.");
        await this.audit.record(
          {
            action: "quote.status_changed",
            entityType: "Quote",
            entityId: id,
            before: { status: before.status },
            after: { status: to },
          },
          tx,
        );
        return this.find(tx, id);
      }),
    );
  }

  /** ACCEPTED → CONVERTED, creating a draft invoice with the quote's lines and tax rate. */
  async convert(id: string): Promise<InvoiceDto> {
    const invoiceId = await this.prisma.db.$transaction(async (tx) => {
      const q = await this.find(tx, id);
      if (q.status !== "ACCEPTED") throw new AppException("CONFLICT", "Only accepted quotes can be invoiced");
      const res = await tx.quote.updateMany({
        where: { id, status: "ACCEPTED" },
        data: { status: "CONVERTED" },
      });
      if (res.count === 0) throw new AppException("CONFLICT", "This quote was already converted");
      // A quote for a job that already has an invoice: don't attach (jobId is unique on invoices).
      const jobFree = q.jobId
        ? !(await tx.invoice.findUnique({ where: { jobId: q.jobId }, select: { id: true } }))
        : false;
      const inv = await this.invoices.insertDraft(
        tx,
        {
          customerId: q.customerId,
          lineItems: q.lineItems.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
          })),
          taxRateBps: q.taxRateBps,
          notes: q.notes,
          dueDate: null,
        },
        { quoteId: q.id, ...(q.jobId && jobFree ? { jobId: q.jobId } : {}) },
      );
      await this.audit.record(
        {
          action: "quote.converted",
          entityType: "Quote",
          entityId: id,
          after: { status: "CONVERTED", invoice: inv.number },
        },
        tx,
      );
      return inv.id;
    });
    return this.invoices.get(invoiceId);
  }

  // ---------------------------------------------------------------------------

  private validUntil(dateKey: string | null | undefined): Date {
    const tz = this.config.business.timezone;
    return endOfZonedDay(
      dateKey ?? addDaysKey(zonedDateKey(new Date(), tz), this.config.invoicing.quoteValidityDays),
      tz,
    );
  }

  private async validateRefs(tx: Tx, data: QuoteData): Promise<void> {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId }, select: { id: true } });
    if (!customer) throw invalidField("customerId", "Customer not found");
    if (data.jobId) {
      const job = await tx.job.findUnique({ where: { id: data.jobId }, select: { customerId: true } });
      if (!job) throw invalidField("jobId", "Job not found");
      if (job.customerId !== data.customerId)
        throw invalidField("jobId", "That job belongs to another customer");
    }
  }

  private async writeLines(
    tx: Tx,
    quoteId: string,
    items: QuoteData["lineItems"],
    totals: { lines: Array<{ totalMinor: number }> },
  ): Promise<void> {
    await tx.quoteLineItem.createMany({
      data: items.map((l, position) => ({
        organizationId: currentOrganizationId(),
        quoteId,
        description: l.description,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        totalMinor: totals.lines[position]!.totalMinor,
        position,
      })),
    });
  }

  private async find(db: Pick<Tx, "quote">, id: string): Promise<QuoteRow> {
    const q = await db.quote.findUnique({ where: { id }, include: quoteInclude });
    if (!q) throw new AppException("NOT_FOUND", "Quote not found");
    return q;
  }
}
