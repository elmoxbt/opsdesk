import { z } from "zod";
import { overlaps } from "../scheduling";
import { zonedTimeToUtc } from "../time";
import { optionalText } from "./common";
import { phoneSchema } from "./customers";

// ---------------------------------------------------------------------------
// Phone matching
// ---------------------------------------------------------------------------

/**
 * Comparable form of a phone number: digits only, last 10. "+234 803 555 0101",
 * "0803-555-0101" and "2348035550101" all give "8035550101", so a returning
 * customer who types their number differently is still recognised.
 */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

// ---------------------------------------------------------------------------
// Public booking
// ---------------------------------------------------------------------------

export const bookingInputSchema = z.object({
  serviceTypeId: z.uuid("Choose a service"),
  /** A slot start returned by the availability endpoint. Re-checked on submit. */
  start: z.iso.datetime({ offset: true, message: "Choose a time" }),
  name: z.string().trim().min(2, "Enter your name").max(100),
  phone: phoneSchema,
  // nullish: the browser sends the PARSED form (null), the server parses it again.
  email: z
    .union([z.literal(""), z.email("Enter a valid email")])
    .nullish()
    .transform((v) => v || null),
  address: z.string().trim().min(5, "Enter the address for the visit").max(300),
  notes: optionalText(1000),
  /** Honeypot: humans never see this field; bots fill it in. */
  website: z.string().max(0).optional(),
});
export type BookingInput = z.input<typeof bookingInputSchema>;
export type BookingData = z.output<typeof bookingInputSchema>;

export const availabilityQuerySchema = z.object({
  serviceTypeId: z.uuid(),
  date: z.iso.date(),
});

export type OpeningHours = Readonly<Record<string, readonly [string, string] | null>>;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export interface SlotRequest {
  /** "2026-11-20" in the business's calendar. */
  dateKey: string;
  timeZone: string;
  hours: OpeningHours;
  slotMinutes: number;
  durationMinutes: number;
  /** Nothing earlier than this is offered (now + lead time). */
  earliest: Date;
  /** Active technicians who could take the job. */
  technicianIds: readonly string[];
  /** Committed jobs (blocking statuses) that day, per technician. */
  busy: ReadonlyArray<{ technicianId: string; start: Date; end: Date }>;
}

export interface Slot {
  start: string;
  end: string;
  /** How many technicians are free for the whole slot (0 = full). */
  free: number;
}

/**
 * The bookable slots for one day: on the slot grid, inside opening hours, the
 * whole job fits before closing, not in the past (+ lead time), and at least
 * one technician free for the full duration. Pure, so it's unit-tested
 * without a database, and the API re-runs it on submit (no stale-slot bookings).
 */
export function computeSlots(r: SlotRequest): Slot[] {
  const [y, m, d] = r.dateKey.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  const hours = r.hours[weekday];
  if (!hours || r.technicianIds.length === 0) return [];

  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const [open, close] = [toMin(hours[0]), toMin(hours[1])];
  const slots: Slot[] = [];
  for (let t = open; t + r.durationMinutes <= close; t += r.slotMinutes) {
    const start = zonedTimeToUtc(y, m, d, Math.floor(t / 60), t % 60, r.timeZone);
    if (start < r.earliest) continue;
    const end = new Date(start.getTime() + r.durationMinutes * 60_000);
    const free = r.technicianIds.filter(
      (tech) => !r.busy.some((b) => b.technicianId === tech && overlaps(b, { start, end })),
    ).length;
    slots.push({ start: start.toISOString(), end: end.toISOString(), free });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_CHANNELS = ["EMAIL", "SMS", "WHATSAPP"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
