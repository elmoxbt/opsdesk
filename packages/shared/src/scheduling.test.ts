import { describe, expect, it } from "vitest";
import { findConflicts, overlaps } from "./scheduling";

const at = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 1, h, m));

describe("overlaps", () => {
  it("detects partial and full overlap", () => {
    expect(overlaps({ start: at(9), end: at(11) }, { start: at(10), end: at(12) })).toBe(true);
    expect(overlaps({ start: at(9), end: at(12) }, { start: at(10), end: at(11) })).toBe(true);
  });

  it("treats back-to-back slots as free (half-open intervals)", () => {
    expect(overlaps({ start: at(9), end: at(10) }, { start: at(10), end: at(11) })).toBe(false);
  });

  it("accepts ISO strings", () => {
    expect(
      overlaps(
        { start: "2030-01-01T09:00:00Z", end: "2030-01-01T10:00:00Z" },
        { start: at(9, 30), end: at(9, 45) },
      ),
    ).toBe(true);
  });
});

describe("findConflicts", () => {
  const job = (
    id: string,
    tech: string | null,
    start: number,
    end: number,
    status = "SCHEDULED" as const,
  ) => ({
    id,
    status,
    technicianId: tech,
    scheduledStart: at(start),
    scheduledEnd: at(end),
  });

  it("only counts the same technician, blocking statuses, and other jobs", () => {
    const others = [
      job("a", "t1", 9, 10),
      job("b", "t2", 9, 10),
      { ...job("c", "t1", 9, 10), status: "COMPLETED" as const },
      { ...job("d", "t1", 9, 10), status: "CANCELLED" as const },
      job("self", "t1", 9, 10),
    ];
    const hits = findConflicts({ id: "self", technicianId: "t1", start: at(9, 30), end: at(10, 30) }, others);
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });
});
