import { z } from "zod";
import type { ISODate } from "./dto";
import type { OpeningHours } from "./schemas/booking";

/**
 * Analytics helpers. Everything here works on calendar date keys
 * ("2026-11-18") in the BUSINESS's time zone, so "revenue on Tuesday" means
 * Tuesday in Lagos for every viewer. Pure functions: unit-tested, shared by
 * the API (aggregation) and the web app (axis labels).
 */

export const MAX_RANGE_DAYS = 366;

export const analyticsQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((q) => q.from <= q.to, { message: "Start must be on or before the end", path: ["to"] })
  .refine((q) => daysBetween(q.from, q.to) < MAX_RANGE_DAYS, {
    message: `At most ${MAX_RANGE_DAYS} days`,
    path: ["to"],
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export type Granularity = "day" | "week" | "month";

const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (key: string, n: number): string => fmt(parse(key) + n * 86_400_000);
/** Whole days from `a` to `b` (b - a). */
export const daysBetween = (a: string, b: string): number => Math.round((parse(b) - parse(a)) / 86_400_000);

/** Up to a month: daily points; up to ~4 months: weekly; longer: monthly. Keeps charts at 5–60 points. */
export function granularityFor(from: string, to: string): Granularity {
  const days = daysBetween(from, to) + 1;
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

/** The bucket a day falls into: itself, its Monday (ISO weeks), or the 1st of its month. */
export function bucketOf(key: string, g: Granularity): string {
  if (g === "day") return key;
  if (g === "month") return `${key.slice(0, 7)}-01`;
  const dow = (new Date(parse(key)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(key, -dow);
}

/** Every bucket from `from` to `to`, in order, including empty ones (charts need the zeros). */
export function enumerateBuckets(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  for (let b = bucketOf(from, g); b <= to;) {
    out.push(b);
    if (g === "day") b = addDays(b, 1);
    else if (g === "week") b = addDays(b, 7);
    else {
      const d = new Date(parse(b));
      b = fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
  }
  return out;
}

/** The equally long period immediately before, for "vs previous period" deltas. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Minutes the business is open between two date keys (inclusive): one technician's capacity. */
export function openMinutes(from: string, to: string, hours: OpeningHours): number {
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  let total = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const h = hours[WEEKDAY[new Date(parse(k)).getUTCDay()]!];
    if (h) total += toMin(h[1]) - toMin(h[0]);
  }
  return total;
}

/** Relative change, or null when there's nothing to compare against. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export interface Kpi {
  value: number | null;
  previous: number | null;
}

export interface AnalyticsOverviewDto {
  range: { from: string; to: string; previousFrom: string; previousTo: string; granularity: Granularity };
  currency: string;
  generatedAt: ISODate;
  kpis: {
    /** Money received (successful payments), cash basis. */
    revenueMinor: Kpi;
    /** Invoices issued (non-void), by issue date. */
    invoicedMinor: Kpi;
    jobsCompleted: Kpi;
    /** Average price of jobs completed. */
    avgJobValueMinor: Kpi;
    /** Booked technician hours ÷ open hours × technicians, 0–1. */
    utilisation: Kpi;
    /** Issue → paid, for invoices paid in the range. */
    avgDaysToPay: Kpi;
  };
  series: Array<{ bucket: string; revenueMinor: number; jobsCompleted: number }>;
  byService: Array<{ id: string; name: string; jobs: number; valueMinor: number }>;
  technicians: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    jobsCompleted: number;
    bookedHours: number;
    utilisation: number;
    valueMinor: number;
  }>;
  /** Jobs created in the range, by where they came from. */
  sources: Record<"DASHBOARD" | "BOOKING" | "API", number>;
  /** Unpaid invoice balances as of now, by days past due. */
  receivables: {
    currentMinor: number;
    days1to30Minor: number;
    days31to60Minor: number;
    days60plusMinor: number;
  };
}
