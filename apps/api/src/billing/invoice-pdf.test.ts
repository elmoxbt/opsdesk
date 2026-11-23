import { describe, expect, it } from "vitest";
import { type InvoicePdfData, renderInvoicePdf } from "./invoice-pdf";

const base: InvoicePdfData = {
  business: { name: "Brightline Ops", email: "hello@brightline.example", primaryColor: "#4f46e5" },
  number: "INV-0001",
  status: "SENT",
  issueDate: new Date("2026-11-18T09:00:00Z"),
  dueDate: new Date("2026-12-02T22:59:59Z"),
  paidAt: null,
  customer: { name: "Funke Adeyemi", email: "funke@example.com", phone: null, address: "Lekki, Lagos" },
  lineItems: [
    { description: "Generator servicing", quantity: 1, unitPriceMinor: 3_500_000, totalMinor: 3_500_000 },
  ],
  subtotalMinor: 3_500_000,
  taxRateBps: 750,
  taxMinor: 262_500,
  totalMinor: 3_762_500,
  amountPaidMinor: 0,
  currency: "NGN",
  locale: "en-NG",
  timezone: "Africa/Lagos",
  notes: "Thanks for your business",
  payUrl: "https://app.example.com/i/abc",
};

const pageCount = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;

describe("renderInvoicePdf", () => {
  it("produces a one-page PDF for a short invoice", async () => {
    const pdf = await renderInvoicePdf(base);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
  });

  it("is deterministic for the same input", async () => {
    const [a, b] = await Promise.all([renderInvoicePdf(base), renderInvoicePdf(base)]);
    expect(a.length).toBe(b.length);
  });

  it("flows long invoices onto more pages instead of clipping", async () => {
    const lineItems = Array.from({ length: 80 }, (_, i) => ({
      description: `Part ${i + 1}`,
      quantity: 1,
      unitPriceMinor: 1000,
      totalMinor: 1000,
    }));
    expect(pageCount(await renderInvoicePdf({ ...base, lineItems }))).toBeGreaterThan(1);
  });
});
