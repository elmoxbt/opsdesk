import { toZonedInputValue, zonedDateKey, zonedTimeToUtc } from "@opsdesk/shared";

/** Visible working hours on the day view, and the vertical scale. */
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 21;
export const HOUR_PX = 64;
export const SNAP_MINUTES = 15;
export const DAY_HEIGHT_PX = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;

/** Calendar-date keys ("2026-11-18") are zone-free, so plain UTC arithmetic on them is safe. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday of the week containing `key`. */
export function startOfWeek(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}

export const weekDays = (key: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(key), i));

/** UTC instant of a wall-clock time on a calendar day in `tz`. */
export function atLocal(key: string, minutesOfDay: number, tz: string): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return zonedTimeToUtc(y, m, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60, tz);
}

/** [from, to) for the board query, in the business's zone. */
export function rangeFor(view: "day" | "week", key: string, tz: string): { from: string; to: string } {
  const first = view === "day" ? key : startOfWeek(key);
  const days = view === "day" ? 1 : 7;
  return {
    from: atLocal(first, 0, tz).toISOString(),
    to: atLocal(addDays(first, days), 0, tz).toISOString(),
  };
}

export function minutesOfDay(iso: string, tz: string): number {
  const [, time = "00:00"] = toZonedInputValue(iso, tz).split("T");
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export const dayKeyOf = (iso: string, tz: string): string => zonedDateKey(new Date(iso), tz);

export const snap = (minutes: number): number => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;

/** Pixel geometry of a job on the day grid, clamped to the visible hours. */
export function geometry(
  startIso: string,
  endIso: string,
  dayKey: string,
  tz: string,
): { top: number; height: number } {
  const dayStart = DAY_START_HOUR * 60;
  const dayEnd = DAY_END_HOUR * 60;
  // A job that started yesterday or ends tomorrow is clipped to this day.
  const s = dayKeyOf(startIso, tz) < dayKey ? 0 : minutesOfDay(startIso, tz);
  const e = dayKeyOf(endIso, tz) > dayKey ? 24 * 60 : minutesOfDay(endIso, tz);
  const top = ((Math.max(s, dayStart) - dayStart) / 60) * HOUR_PX;
  const bottom = ((Math.min(Math.max(e, dayStart), dayEnd) - dayStart) / 60) * HOUR_PX;
  return { top, height: Math.max(bottom - top, 22) };
}

/** Where a card dropped at `offsetPx` from the top of a day column should start (snapped, kept on the grid). */
export function startFromOffset(dayKey: string, offsetPx: number, durationMinutes: number, tz: string): Date {
  const raw = DAY_START_HOUR * 60 + (offsetPx / HOUR_PX) * 60;
  const latest = DAY_END_HOUR * 60 - Math.min(durationMinutes, (DAY_END_HOUR - DAY_START_HOUR) * 60);
  const minutes = Math.min(Math.max(snap(raw), DAY_START_HOUR * 60), latest);
  return atLocal(dayKey, minutes, tz);
}

/** Moving a job to another day in week view keeps its time of day (or 09:00 for unscheduled jobs). */
export function sameTimeOnDay(originalIso: string | null, dayKey: string, tz: string): Date {
  return atLocal(dayKey, originalIso ? minutesOfDay(originalIso, tz) : 9 * 60, tz);
}

/**
 * Side-by-side lanes for overlapping cards in one column (e.g. a completed job
 * that overran into the next booking). Greedy interval partitioning: O(n log n).
 */
export function assignLanes<T extends { id: string; start: number; end: number }>(
  items: T[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: Array<T & { lane: number }> = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) result.set(c.id, { lane: c.lane, lanes });
    cluster = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -Infinity, c.end);
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ ...item, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}
