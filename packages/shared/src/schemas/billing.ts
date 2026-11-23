import { z } from "zod";
import { optionalText, paginationQuerySchema, searchQuery } from "./common";

// ---------------------------------------------------------------------------
// Line items & totals (shared by quotes and invoices, server and client)
// ---------------------------------------------------------------------------

export const lineItemInputSchema = z.object({
  description: z.string().trim().min(1, "Describe the item").max(300),
  quantity: z.coerce.number().int().min(1, "At least 1").max(10_000),
  /** Minor units (kobo/cents). The UI converts from what the user typed. */
  unitPriceMinor: z.coerce.number().int().min(0, "Cannot be negative").max(10_000_000_000),
});
export type LineItemInput = z.input<typeof lineItemInputSchema>;

const lineItems = z
  .array(lineItemInputSchema)
  .min(1, "Add at least one line item")
  .max(100, "At most 100 line items");

export interface Totals {
  lines: Array<{ totalMinor: number }>;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * The ONLY place totals are computed. Integer maths throughout; tax is rounded
 * once, on the subtotal (half away from zero), not per line, so the PDF, the
 * web page and the payment amount always agree to the kobo.
 */
export function computeTotals(
  items: ReadonlyArray<{ quantity: number; unitPriceMinor: number }>,
  taxRateBps: number,
): Totals {
  const lines = items.map((i) => ({ totalMinor: i.quantity * i.unitPriceMinor }));
  const subtotalMinor = lines.reduce((s, l) => s + l.totalMinor, 0);
  const taxMinor = Math.round((subtotalMinor * taxRateBps) / 10_000);
  const totals = { lines, subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
  if (!Number.isSafeInteger(totals.totalMinor)) throw new RangeError("Invoice total out of range");
  return totals;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CONVERTED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quoteInputSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  jobId: z.uuid().nullish(),
  lineItems,
  taxRateBps: z.coerce.number().int().min(0).max(10_000).optional(),
  validUntil: z.iso.date().nullish(),
  notes: optionalText(2000),
});
export type QuoteInput = z.input<typeof quoteInputSchema>;

/** Quotes move forward only; CONVERTED happens via /convert, never by setting it. */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "DECLINED"],
  ACCEPTED: [],
  DECLINED: [],
  CONVERTED: [],
};
export const quoteStatusSchema = z.object({ status: z.enum(["SENT", "ACCEPTED", "DECLINED"]) });

export const quoteListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery,
  status: z.enum(QUOTE_STATUSES).optional(),
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** Statuses where money is still owed. OVERDUE is never stored: it's SENT/PARTIALLY_PAID past the due date. */
export const OPEN_INVOICE_STATUSES = ["SENT", "PARTIALLY_PAID"] as const;

export const invoiceInputSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  lineItems,
  taxRateBps: z.coerce.number().int().min(0).max(10_000).optional(),
  dueDate: z.iso.date().nullish(),
  notes: optionalText(2000),
});
export type InvoiceInput = z.input<typeof invoiceInputSchema>;

export const invoiceFromJobSchema = z.object({ jobId: z.uuid() });

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(3, "Say why it's void").max(500),
});

export const MANUAL_PAYMENT_METHODS = ["cash", "bank_transfer", "pos", "other"] as const;
export const manualPaymentSchema = z.object({
  amountMinor: z.coerce.number().int().min(1, "Enter an amount"),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  paidAt: z.iso.datetime({ offset: true }).optional(),
  note: optionalText(500),
});
export type ManualPaymentInput = z.input<typeof manualPaymentSchema>;

export const invoiceListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery,
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: z.uuid().optional(),
  jobId: z.uuid().optional(),
});

/** Public pay page: the payer's email (Paystack requires one) — prefilled from the customer. */
export const startCheckoutSchema = z.object({ email: z.email("Enter a valid email") });
export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;

/** Displayed status: OVERDUE is derived, so it can never drift from the due date. */
export function effectiveInvoiceStatus(
  inv: { status: InvoiceStatus; dueDate: string | Date },
  now: Date = new Date(),
): InvoiceStatus {
  const open = (OPEN_INVOICE_STATUSES as readonly string[]).includes(inv.status);
  return open && new Date(inv.dueDate).getTime() < now.getTime() ? "OVERDUE" : inv.status;
}
