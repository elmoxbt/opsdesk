/**
 * Time-zone helpers without a date library. Each tenant has its own IANA time
 * zone, so "today" for a Lagos business is not "today" in UTC.
 */
function offsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    +parts.year!,
    +parts.month! - 1,
    +parts.day!,
    +parts.hour!,
    +parts.minute!,
    +parts.second!,
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** UTC instant for a wall-clock time in `timeZone`. */
export function zonedTimeToUtc(
  y: number,
  month: number,
  d: number,
  h: number,
  min: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, month - 1, d, h, min);
  // Two passes handle a DST change between the guess and the real instant.
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** [start, end) of the calendar day containing `at`, as seen in `timeZone`. */
export function zonedDayRange(at: Date, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(at)
    .split("-")
    .map(Number) as [number, number, number];
  const start = zonedTimeToUtc(y, m, d, 0, 0, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = zonedTimeToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    timeZone,
  );
  return { start, end };
}

/** Wall-clock parts of `at` in `timeZone`. */
function zonedParts(at: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, min: p.minute! };
}

/**
 * `<input type="datetime-local">` speaks wall-clock time with no zone. These
 * convert to/from the BUSINESS's zone, so a dispatcher travelling abroad still
 * schedules 9:00 Lagos time, not 9:00 wherever their laptop is.
 */
export function toZonedInputValue(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const { y, m, d, h, min } = zonedParts(new Date(iso), timeZone);
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function fromZonedInputValue(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number) as [number, number, number, number, number, number];
  return zonedTimeToUtc(y, m, d, h, min, timeZone).toISOString();
}

/** "YYYY-MM-DD" of `at` in `timeZone` (for date filters). */
export function zonedDateKey(at: Date, timeZone: string): string {
  const { y, m, d } = zonedParts(at, timeZone);
  return `${y}-${m}-${d}`;
}
