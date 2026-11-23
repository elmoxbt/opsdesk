import { describe, expect, it } from "vitest";
import { customerInputSchema } from "./customers";
import { jobCreateSchema, jobListQuerySchema } from "./jobs";

const ids = {
  customerId: "6f1c2a8e-4b9e-4f7a-9a3e-1d2c3b4a5e6f",
  serviceTypeId: "7f1c2a8e-4b9e-4f7a-9a3e-1d2c3b4a5e6f",
};

describe("jobCreateSchema", () => {
  it("normalises optional fields to null and defaults the checklist", () => {
    const out = jobCreateSchema.parse({ ...ids, notes: "  " });
    expect(out).toMatchObject({
      technicianId: null,
      scheduledStart: null,
      notes: null,
      priceMinor: null,
      checklist: [],
    });
  });

  it("coerces ISO strings to dates and rejects end before start", () => {
    const ok = jobCreateSchema.parse({ ...ids, scheduledStart: "2026-01-01T09:00:00Z" });
    expect(ok.scheduledStart).toBeInstanceOf(Date);
    const bad = jobCreateSchema.safeParse({
      ...ids,
      scheduledStart: "2026-01-01T09:00:00Z",
      scheduledEnd: "2026-01-01T08:00:00Z",
    });
    expect(bad.success).toBe(false);
  });
});

describe("jobListQuerySchema", () => {
  it("accepts comma-separated and repeated statuses", () => {
    expect(jobListQuerySchema.parse({ status: "SCHEDULED,EN_ROUTE" }).status).toEqual([
      "SCHEDULED",
      "EN_ROUTE",
    ]);
    expect(jobListQuerySchema.parse({ status: ["PAID"] }).status).toEqual(["PAID"]);
  });

  it("rejects unknown statuses", () => {
    expect(jobListQuerySchema.safeParse({ status: "DONE" }).success).toBe(false);
  });
});

describe("customerInputSchema", () => {
  it("turns empty optional strings into null", () => {
    expect(
      customerInputSchema.parse({ name: "Ada", phone: "+234 801 234 5678", email: "", address: "" }),
    ).toMatchObject({
      email: null,
      address: null,
      notes: null,
    });
  });
});
