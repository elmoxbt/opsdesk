import { describe, expect, it } from "vitest";
import {
  addDays,
  assignLanes,
  geometry,
  HOUR_PX,
  rangeFor,
  sameTimeOnDay,
  startFromOffset,
  startOfWeek,
  weekDays,
} from "./dispatch";

const TZ = "Africa/Lagos"; // UTC+1, no DST

describe("calendar keys", () => {
  it("adds days across month/year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("weeks start on Monday", () => {
    expect(startOfWeek("2026-11-18")).toBe("2026-11-16"); // Wednesday → Monday
    expect(startOfWeek("2026-11-22")).toBe("2026-11-16"); // Sunday → previous Monday
    expect(weekDays("2026-11-18")).toHaveLength(7);
  });
});

describe("rangeFor", () => {
  it("is local midnight to midnight in the business zone", () => {
    expect(rangeFor("day", "2026-11-18", TZ)).toEqual({
      from: "2026-11-17T23:00:00.000Z",
      to: "2026-11-18T23:00:00.000Z",
    });
    expect(rangeFor("week", "2026-11-18", TZ).from).toBe("2026-11-15T23:00:00.000Z");
  });
});

describe("geometry", () => {
  it("positions by local time from 07:00 at HOUR_PX per hour", () => {
    // 09:00–10:30 Lagos = 08:00–09:30Z
    expect(geometry("2026-11-18T08:00:00Z", "2026-11-18T09:30:00Z", "2026-11-18", TZ)).toEqual({
      top: 2 * HOUR_PX,
      height: 1.5 * HOUR_PX,
    });
  });

  it("clips jobs that start before the visible day and keeps a minimum height", () => {
    expect(geometry("2026-11-17T22:00:00Z", "2026-11-18T07:00:00Z", "2026-11-18", TZ).top).toBe(0);
    expect(geometry("2026-11-18T08:00:00Z", "2026-11-18T08:05:00Z", "2026-11-18", TZ).height).toBe(22);
  });
});

describe("startFromOffset", () => {
  it("snaps to 15 minutes in the business zone", () => {
    // 2h10m below 07:00 → 09:10 → snaps to 09:15 Lagos = 08:15Z
    expect(startFromOffset("2026-11-18", HOUR_PX * (2 + 10 / 60), 60, TZ).toISOString()).toBe(
      "2026-11-18T08:15:00.000Z",
    );
  });

  it("keeps the whole job on the grid", () => {
    expect(startFromOffset("2026-11-18", -500, 60, TZ).toISOString()).toBe("2026-11-18T06:00:00.000Z"); // 07:00
    expect(startFromOffset("2026-11-18", 99_999, 120, TZ).toISOString()).toBe("2026-11-18T18:00:00.000Z"); // 19:00, ends 21:00
  });
});

describe("sameTimeOnDay", () => {
  it("keeps time of day, or defaults to 09:00", () => {
    expect(sameTimeOnDay("2026-11-18T13:30:00Z", "2026-11-20", TZ).toISOString()).toBe(
      "2026-11-20T13:30:00.000Z",
    );
    expect(sameTimeOnDay(null, "2026-11-20", TZ).toISOString()).toBe("2026-11-20T08:00:00.000Z");
  });
});

describe("assignLanes", () => {
  it("gives overlapping items separate lanes and lone items a full column", () => {
    const lanes = assignLanes([
      { id: "a", start: 0, end: 60 },
      { id: "b", start: 30, end: 90 },
      { id: "c", start: 60, end: 120 }, // reuses lane 0 once "a" ends
      { id: "d", start: 200, end: 260 },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
  });
});
