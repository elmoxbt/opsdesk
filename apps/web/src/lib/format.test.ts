import { describe, expect, it } from "vitest";
import { formatTimeRange, initials, relativeTime } from "./format";

describe("format", () => {
  it("formats a time range in the business time zone", () => {
    expect(formatTimeRange("2026-06-01T08:00:00Z", "2026-06-01T09:30:00Z", "Africa/Lagos")).toBe(
      "Mon 1 Jun, 09:00–10:30",
    );
    expect(formatTimeRange(null, null, "Africa/Lagos")).toBe("Not scheduled");
  });

  it("relative times", () => {
    const now = Date.parse("2026-06-01T12:00:00Z");
    expect(relativeTime("2026-06-01T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-06-01T10:00:00Z", now)).toBe("2 hours ago");
  });

  it("initials", () => {
    expect(initials("Ada  Okafor Eze")).toBe("AO");
    expect(initials("chidi")).toBe("C");
  });
});
