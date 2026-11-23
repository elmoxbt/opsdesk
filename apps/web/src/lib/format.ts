import { formatMoney } from "@opsdesk/shared";

/** Dates are shown in the business's time zone, not the viewer's. */
export function formatDateTime(
  iso: string | null | undefined,
  timeZone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
    ...opts,
  }).format(new Date(iso));
}

export function formatTimeRange(start: string | null, end: string | null, timeZone: string): string {
  if (!start) return "Not scheduled";
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(start));
  const t = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return end ? `${day}, ${t(start)}–${t(end)}` : `${day}, ${t(start)}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units)
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return "just now";
}

export const money = (minor: number | null | undefined, currency: string): string =>
  minor === null || minor === undefined ? "—" : formatMoney(minor, currency);

export { initials } from "@opsdesk/ui/utils";
