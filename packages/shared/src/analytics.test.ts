import { describe, expect, it } from "vitest";
import {
  analyticsQuerySchema,
  bucketOf,
  enumerateBuckets,
  granularityFor,
  openMinutes,
  percentChange,
  previousPeriod,
} from "./analytics";

describe("granularity and buckets", () => {
  it("picks daily, weekly or monthly points by range length", () => {
    expect(granularityFor("2026-11-01", "2026-11-30")).toBe("day");
    expect(granularityFor("2026-09-01", "2026-11-30")).toBe("week");
    expect(granularityFor("2026-01-01", "2026-12-31")).toBe("month");
  });

  it("buckets days into ISO weeks (Monday) and months", () => {
    expect(bucketOf("2026-11-18", "week")).toBe("2026-11-16"); // Wed → Mon
    expect(bucketOf("2026-11-16", "week")).toBe("2026-11-16");
    expect(bucketOf("2026-11-22", "week")).toBe("2026-11-16"); // Sun belongs to the week before
    expect(bucketOf("2026-11-18", "month")).toBe("2026-11-01");
  });

  it("lists every bucket, including empty ones, across month and year ends", () => {
    expect(enumerateBuckets("2026-11-29", "2026-12-02", "day")).toEqual([
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
    expect(enumerateBuckets("2026-11-18", "2026-12-01", "week")).toEqual([
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
    expect(enumerateBuckets("2026-11-15", "2027-02-01", "month")).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
      "2027-02-01",
    ]);
  });
});

describe("periods", () => {
  it("compares with the equally long period just before", () => {
    expect(previousPeriod("2026-11-01", "2026-11-30")).toEqual({ from: "2026-10-02", to: "2026-10-31" });
    expect(previousPeriod("2026-11-18", "2026-11-18")).toEqual({ from: "2026-11-17", to: "2026-11-17" });
  });

  it("has no % change against zero or missing data", () => {
    expect(percentChange(150, 100)).toBeCloseTo(0.5);
    expect(percentChange(50, 100)).toBeCloseTo(-0.5);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 3)).toBeNull();
  });

  it("validates ranges", () => {
    expect(analyticsQuerySchema.safeParse({ from: "2026-11-02", to: "2026-11-01" }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ from: "2025-01-01", to: "2026-11-01" }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
  });
});

describe("openMinutes", () => {
  it("adds up opening hours per weekday, skipping closed days", () => {
    const hours = {
      mon: ["08:00", "18:00"],
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: ["09:00", "14:00"],
      sun: null,
    } as const;
    // 2026-11-16 Mon … 2026-11-22 Sun
    expect(openMinutes("2026-11-16", "2026-11-22", hours)).toBe(600 + 300);
  });
});
