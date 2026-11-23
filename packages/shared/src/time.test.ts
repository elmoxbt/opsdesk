import { describe, expect, it } from "vitest";
import { fromZonedInputValue, toZonedInputValue, zonedDateKey, zonedDayRange, zonedTimeToUtc } from "./time";

describe("zonedTimeToUtc", () => {
  it("handles a fixed-offset zone (Lagos, UTC+1)", () => {
    expect(zonedTimeToUtc(2026, 3, 10, 9, 0, "Africa/Lagos").toISOString()).toBe("2026-03-10T08:00:00.000Z");
  });

  it("handles DST (New York, summer UTC-4 vs winter UTC-5)", () => {
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, "America/New_York").toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, "America/New_York").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });
});

describe("zonedDayRange", () => {
  it("returns the local day, which can differ from the UTC day", () => {
    // 23:30 UTC on Mar 10 is already 00:30 on Mar 11 in Lagos.
    const { start, end } = zonedDayRange(new Date("2026-03-10T23:30:00Z"), "Africa/Lagos");
    expect(start.toISOString()).toBe("2026-03-10T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-11T23:00:00.000Z");
  });

  it("is 23 hours long on a spring-forward day", () => {
    const { start, end } = zonedDayRange(new Date("2026-03-08T15:00:00Z"), "America/New_York");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });
});

describe("datetime-local conversion in the business time zone", () => {
  it("round-trips through the org zone regardless of the machine zone", () => {
    const iso = fromZonedInputValue("2026-06-01T09:30", "Africa/Lagos");
    expect(iso).toBe("2026-06-01T08:30:00.000Z");
    expect(toZonedInputValue(iso, "Africa/Lagos")).toBe("2026-06-01T09:30");
  });

  it("handles empty and invalid values", () => {
    expect(toZonedInputValue(null, "Africa/Lagos")).toBe("");
    expect(fromZonedInputValue("", "Africa/Lagos")).toBeNull();
  });

  it("zonedDateKey uses the local calendar day", () => {
    expect(zonedDateKey(new Date("2026-03-10T23:30:00Z"), "Africa/Lagos")).toBe("2026-03-11");
  });
});
