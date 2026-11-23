import type { Payment, Prisma } from "@opsdesk/db";
import {
  effectiveInvoiceStatus,
  type InvoiceDto,
  type LineItemDto,
  type PaymentDto,
  type QuoteDto,
  zonedTimeToUtc,
} from "@opsdesk/shared";
import { iso, isoOrNull } from "../common/mapping";

export const invoiceInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true, address: true } },
  job: { select: { number: true } },
  lineItems: { orderBy: { position: "asc" } },
  payments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export const quoteInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  lineItems: { orderBy: { position: "asc" } },
  invoice: { select: { id: true } },
  organization: { select: { currency: true } },
} satisfies Prisma.QuoteInclude;
export type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

const toLine = (l: {
  id: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}): LineItemDto => ({
  id: l.id,
  description: l.description,
  quantity: l.quantity,
  unitPriceMinor: l.unitPriceMinor,
  totalMinor: l.totalMinor,
});

export function toPaymentDto(p: Payment): PaymentDto {
  return {
    id: p.id,
    provider: p.provider,
    reference: p.reference,
    amountMinor: p.amountMinor,
    currency: p.currency,
    status: p.status,
    method: p.method,
    note: p.note,
    paidAt: isoOrNull(p.paidAt),
    createdAt: iso(p.createdAt),
  };
}

export const publicInvoiceUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/$/, "")}/i/${token}`;

export function toInvoiceDto(i: InvoiceRow, appUrl: string, now = new Date()): InvoiceDto {
  // OVERDUE is never stored; the DB enum value exists only for legacy rows.
  const status = (i.status === "OVERDUE" ? "SENT" : i.status) as InvoiceDto["status"];
  return {
    id: i.id,
    number: i.number,
    status,
    displayStatus: effectiveInvoiceStatus({ status, dueDate: i.dueDate }, now),
    customer: i.customer,
    jobId: i.jobId,
    jobNumber: i.job?.number ?? null,
    quoteId: i.quoteId,
    currency: i.currency,
    taxRateBps: i.taxRateBps,
    subtotalMinor: i.subtotalMinor,
    taxMinor: i.taxMinor,
    totalMinor: i.totalMinor,
    amountPaidMinor: i.amountPaidMinor,
    balanceMinor: Math.max(0, i.totalMinor - i.amountPaidMinor),
    issueDate: iso(i.issueDate),
    dueDate: iso(i.dueDate),
    sentAt: isoOrNull(i.sentAt),
    paidAt: isoOrNull(i.paidAt),
    voidedAt: isoOrNull(i.voidedAt),
    voidReason: i.voidReason,
    reminderCount: i.reminderCount,
    lastReminderAt: isoOrNull(i.lastReminderAt),
    notes: i.notes,
    pdfReady: i.pdfVersion > 0 && i.pdfRenderedVersion === i.pdfVersion && !!i.pdfS3Key,
    publicUrl: status === "DRAFT" ? null : publicInvoiceUrl(appUrl, i.publicToken),
    lineItems: i.lineItems.map(toLine),
    payments: i.payments.map(toPaymentDto),
    createdAt: iso(i.createdAt),
    updatedAt: iso(i.updatedAt),
  };
}

export function toQuoteDto(q: QuoteRow): QuoteDto {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    customer: q.customer,
    jobId: q.jobId,
    invoiceId: q.invoice?.id ?? null,
    currency: q.organization.currency,
    taxRateBps: q.taxRateBps,
    subtotalMinor: q.subtotalMinor,
    taxMinor: q.taxMinor,
    totalMinor: q.totalMinor,
    validUntil: isoOrNull(q.validUntil),
    notes: q.notes,
    lineItems: q.lineItems.map(toLine),
    createdAt: iso(q.createdAt),
    updatedAt: iso(q.updatedAt),
  };
}

/**
 * A calendar date ("2026-12-02") as the LAST instant of that day in the
 * business's time zone. "Due 2 Dec" means payable all of 2 Dec in Lagos, not
 * until midnight UTC.
 */
export function endOfZonedDay(dateKey: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return new Date(
    zonedTimeToUtc(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      0,
      0,
      timeZone,
    ).getTime() - 1,
  );
}

export const addDaysKey = (dateKey: string, days: number): string => {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
