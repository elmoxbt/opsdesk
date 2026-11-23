import { describe, expect, it } from "vitest";
import { computeTotals, effectiveInvoiceStatus, lineItemInputSchema } from "./schemas/billing";

describe("computeTotals", () => {
  it("multiplies lines and sums them", () => {
    const t = computeTotals(
      [
        { quantity: 2, unitPriceMinor: 1_500_000 },
        { quantity: 1, unitPriceMinor: 450_000 },
      ],
      0,
    );
    expect(t.lines.map((l) => l.totalMinor)).toEqual([3_000_000, 450_000]);
    expect(t).toMatchObject({ subtotalMinor: 3_450_000, taxMinor: 0, totalMinor: 3_450_000 });
  });

  it("rounds tax once, on the subtotal", () => {
    // 3 lines of 1 kobo at 7.5%: per-line rounding would give 0+0+0, the subtotal gives round(0.225) = 0;
    // 7 kobo at 7.5% = 0.525 -> 1. Tax on the subtotal is what the customer can recompute.
    expect(computeTotals([{ quantity: 7, unitPriceMinor: 1 }], 750).taxMinor).toBe(1);
    expect(computeTotals([{ quantity: 1, unitPriceMinor: 1_000_000 }], 750)).toMatchObject({
      taxMinor: 75_000,
      totalMinor: 1_075_000,
    });
  });

  it("rejects totals that would lose integer precision", () => {
    expect(() =>
      computeTotals([{ quantity: 10_000, unitPriceMinor: Number.MAX_SAFE_INTEGER / 10 }], 0),
    ).toThrow(RangeError);
  });
});

describe("lineItemInputSchema", () => {
  it("rejects fractional quantities and negative prices", () => {
    expect(
      lineItemInputSchema.safeParse({ description: "x", quantity: 1.5, unitPriceMinor: 1 }).success,
    ).toBe(false);
    expect(lineItemInputSchema.safeParse({ description: "x", quantity: 1, unitPriceMinor: -1 }).success).toBe(
      false,
    );
  });
});

describe("effectiveInvoiceStatus", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  it("derives OVERDUE only for open invoices past due", () => {
    const past = "2026-11-17T22:59:59.999Z";
    expect(effectiveInvoiceStatus({ status: "SENT", dueDate: past }, now)).toBe("OVERDUE");
    expect(effectiveInvoiceStatus({ status: "PARTIALLY_PAID", dueDate: past }, now)).toBe("OVERDUE");
    expect(effectiveInvoiceStatus({ status: "PAID", dueDate: past }, now)).toBe("PAID");
    expect(effectiveInvoiceStatus({ status: "DRAFT", dueDate: past }, now)).toBe("DRAFT");
    expect(effectiveInvoiceStatus({ status: "SENT", dueDate: "2026-11-30T00:00:00Z" }, now)).toBe("SENT");
  });
});
