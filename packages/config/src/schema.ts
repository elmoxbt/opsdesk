import { z } from "zod";

/** Every optional module. Adding one here makes it configurable everywhere. */
export const FEATURES = [
  "inventory",
  "payments",
  "bookingPortal",
  "technicianApp",
  "analytics",
  "publicApi",
] as const;
export type Feature = (typeof FEATURES)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #4f46e5");

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown IANA time zone (e.g. Africa/Lagos)");

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => SUPPORTED_CURRENCIES.has(c), "Unknown ISO 4217 currency code (e.g. NGN, USD)");

const locale = z.string().refine((l) => {
  try {
    return Intl.getCanonicalLocales(l).length === 1;
  } catch {
    return false;
  }
}, "Invalid locale (e.g. en-NG)");

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/,
    "A hostname like app.example.com (no scheme, no path)",
  );

/** Absolute https URL, or a path served by the web app (e.g. /brand/logo.svg). */
const assetRef = z.union([
  z.url({ protocol: /^https$/ }),
  z.string().regex(/^\/[\w\-./]+$/, "Use https://… or a /path"),
]);

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24h HH:MM, e.g. 08:00");
/** [open, close] in business-local time, e.g. ["08:00", "18:00"]. */
const openingHours = z
  .tuple([hhmm, hhmm])
  .refine(([open, close]) => open < close, "Closing time must be after opening time");

const DEFAULT_HOURS: Record<Weekday, [string, string] | null> = {
  mon: ["08:00", "18:00"],
  tue: ["08:00", "18:00"],
  wed: ["08:00", "18:00"],
  thu: ["08:00", "18:00"],
  fri: ["08:00", "18:00"],
  sat: ["09:00", "14:00"],
  sun: null,
};

export const clientConfigSchema = z
  .object({
    business: z.object({
      name: z.string().trim().min(2).max(100),
      /** Internal identifier and booking-page path. */
      slug: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and hyphens")
        .min(3)
        .max(40),
      email: z.email(),
      phone: z.string().trim().max(30).optional(),
      address: z.string().trim().max(300).optional(),
      website: z.url().optional(),
      timezone,
      currency,
      locale: locale.default("en-NG"),
      /** Default tax rate in basis points (750 = 7.5%). */
      taxRateBps: z.int().min(0).max(10_000).default(0),
    }),
    branding: z.object({
      /** Product name shown in the UI and browser tab. Defaults to the business name. */
      appName: z.string().trim().min(1).max(40).optional(),
      primaryColor: hexColor,
      logoUrl: assetRef.optional(),
      faviconUrl: assetRef.optional(),
      tagline: z.string().trim().max(120).optional(),
    }),
    /** Every feature must be listed explicitly: no surprise defaults when a module ships. */
    features: z.object(
      Object.fromEntries(FEATURES.map((f) => [f, z.boolean()])) as Record<Feature, z.ZodBoolean>,
    ),
    payments: z.object({ provider: z.enum(["paystack", "stripe"]) }).optional(),
    /** Quote/invoice defaults. Every field has a sensible default, so the block is optional. */
    invoicing: z
      .object({
        /** Invoice due date = issue date + this. */
        paymentTermsDays: z.int().min(0).max(120).default(14),
        /** How long a quote stays valid. */
        quoteValidityDays: z.int().min(1).max(365).default(30),
        /** Markup on parts' unit cost when an invoice is built from a job (2000 = 20%). */
        partsMarkupBps: z.int().min(0).max(100_000).default(0),
        /** Overdue reminders: one every N days after the due date, at most `maxReminders`. */
        reminderIntervalDays: z.int().min(1).max(60).default(3),
        maxReminders: z.int().min(0).max(20).default(3),
        /** Printed at the bottom of every invoice PDF (bank details, thank-you note). */
        footer: z.string().trim().max(500).optional(),
      })
      .prefault({}),
    /** Public booking page (the `bookingPortal` feature). Times are in business.timezone. */
    booking: z
      .object({
        /** Opening hours per weekday; null = closed. Bookable slots fall inside these. */
        hours: z
          .object(
            Object.fromEntries(WEEKDAYS.map((d) => [d, openingHours.nullable()])) as Record<
              Weekday,
              z.ZodNullable<typeof openingHours>
            >,
          )
          .default(DEFAULT_HOURS),
        /** Slot grid, e.g. 60 = slots start on the hour. */
        slotMinutes: z
          .int()
          .refine((m) => [15, 30, 60, 120].includes(m), "15, 30, 60 or 120")
          .default(60),
        /** Earliest bookable time = now + this. */
        leadTimeHours: z.int().min(0).max(168).default(2),
        /** How far ahead customers can book. */
        horizonDays: z.int().min(1).max(90).default(21),
      })
      .prefault({}),
    /** Which channels customer messages use (each also needs the customer's email/phone). */
    notifications: z
      .object({
        email: z.boolean().default(true),
        sms: z.boolean().default(false),
        whatsapp: z.boolean().default(false),
      })
      .prefault({}),
    /** Created by `bootstrap` on first deploy. The password comes from OWNER_INITIAL_PASSWORD. */
    owner: z.object({ name: z.string().trim().min(1).max(100), email: z.email() }),
    domains: z.object({ app: hostname }),
  })
  .superRefine((c, ctx) => {
    if (c.features.payments && !c.payments) {
      ctx.addIssue({
        code: "custom",
        path: ["payments", "provider"],
        message: "Required when features.payments is enabled",
      });
    }
  });

/** What authors write (defaults optional). */
export type ClientConfigInput = z.input<typeof clientConfigSchema>;
/** What the app reads (defaults applied, validated). */
export type ClientConfig = z.output<typeof clientConfigSchema>;
