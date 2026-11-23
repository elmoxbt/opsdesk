import { describe, expect, it } from "vitest";
import { bookingInputSchema, computeSlots, phoneKey } from "./schemas/booking";

const HOURS = {
  mon: ["08:00", "12:00"],
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
} as const;
const TZ = "Africa/Lagos"; // UTC+1, no DST
const base = {
  dateKey: "2026-11-23", // a Monday
  timeZone: TZ,
  hours: HOURS,
  slotMinutes: 60,
  durationMinutes: 90,
  earliest: new Date("2026-11-01T00:00:00Z"),
  technicianIds: ["a", "b"],
  busy: [],
};
const local = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

describe("computeSlots", () => {
  it("offers grid slots inside opening hours where the whole job fits before closing", () => {
    // 08:00–12:00, 90-minute job: 08:00, 09:00, 10:00 (10:00+1h30 = 11:30); 11:00 would end at 12:30.
    expect(computeSlots(base).map((s) => local(s.start))).toEqual(["08:00", "09:00", "10:00"]);
  });

  it("is closed on closed days and with no technicians", () => {
    expect(computeSlots({ ...base, dateKey: "2026-11-24" })).toEqual([]);
    expect(computeSlots({ ...base, technicianIds: [] })).toEqual([]);
  });

  it("drops slots before the lead time", () => {
    const earliest = new Date("2026-11-23T08:30:00Z"); // 09:30 Lagos
    expect(computeSlots({ ...base, earliest }).map((s) => local(s.start))).toEqual(["10:00"]);
  });

  it("counts technicians free for the WHOLE slot", () => {
    const busy = [
      // a: 09:00–10:00 local. b: 10:30–11:00 local.
      { technicianId: "a", start: new Date("2026-11-23T08:00:00Z"), end: new Date("2026-11-23T09:00:00Z") },
      { technicianId: "b", start: new Date("2026-11-23T09:30:00Z"), end: new Date("2026-11-23T10:00:00Z") },
    ];
    const free = computeSlots({ ...base, busy }).map((s) => [local(s.start), s.free]);
    // 08:00–09:30 overlaps a's 09:00 job; 09:00–10:30 overlaps a; 10:00–11:30 overlaps b's 10:30.
    expect(free).toEqual([
      ["08:00", 1],
      ["09:00", 1],
      ["10:00", 1],
    ]);
    const both = [
      ...busy,
      { technicianId: "b", start: new Date("2026-11-23T07:00:00Z"), end: new Date("2026-11-23T08:00:00Z") },
    ];
    expect(computeSlots({ ...base, busy: both })[0]!.free).toBe(0);
  });
});

describe("phoneKey", () => {
  it("matches the same number however it's typed", () => {
    expect(phoneKey("+234 803 555 0101")).toBe("8035550101");
    expect(phoneKey("0803-555-0101")).toBe("8035550101");
    expect(phoneKey("(234) 8035550101")).toBe("8035550101");
  });
});

describe("bookingInputSchema", () => {
  const ok = {
    serviceTypeId: "7c0b0d3e-6a54-4f6e-9d4f-0d0c3c1b2a11",
    start: "2026-11-23T08:00:00.000Z",
    name: "Funke",
    phone: "0803 555 0101",
    address: "14 Admiralty Way",
  };
  it("accepts a minimal booking and normalises an empty email to null", () => {
    expect(bookingInputSchema.parse({ ...ok, email: "" }).email).toBeNull();
  });
  it("accepts its own output (the client sends parsed data, the server parses again)", () => {
    const once = bookingInputSchema.parse({ ...ok, email: "", notes: "" });
    expect(bookingInputSchema.parse(once)).toEqual(once);
  });
  it("rejects a filled honeypot", () => {
    expect(bookingInputSchema.safeParse({ ...ok, website: "spam.example" }).success).toBe(false);
  });
});
