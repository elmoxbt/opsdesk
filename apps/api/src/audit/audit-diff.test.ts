import { describe, expect, it } from "vitest";
import { auditDiff, snapshot } from "./audit-diff";

describe("auditDiff", () => {
  it("returns only changed keys, with dates as ISO strings", () => {
    const d1 = new Date("2026-01-01T09:00:00Z");
    const d2 = new Date("2026-01-01T10:00:00Z");
    expect(
      auditDiff({ name: "A", phone: "1", at: d1 }, { name: "A", phone: "2", at: d2 }, [
        "name",
        "phone",
        "at",
      ]),
    ).toEqual({ before: { phone: "1", at: d1.toISOString() }, after: { phone: "2", at: d2.toISOString() } });
  });

  it("returns null when nothing changed", () => {
    expect(auditDiff({ a: [1, 2] }, { a: [1, 2] }, ["a"])).toBeNull();
  });

  it("treats undefined and null as equal", () => {
    expect(auditDiff({ a: undefined }, { a: null }, ["a"])).toBeNull();
  });
});

describe("snapshot", () => {
  it("picks keys and normalises values", () => {
    expect(snapshot({ a: 1, b: new Date(0), c: "skip" }, ["a", "b"])).toEqual({
      a: 1,
      b: "1970-01-01T00:00:00.000Z",
    });
  });
});
