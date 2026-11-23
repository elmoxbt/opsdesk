/**
 * Every message the system sends, in one file. Each template returns an
 * email (subject + text) and a short form for SMS/WhatsApp (keep it under
 * ~300 characters: two SMS segments). Plain functions: easy to review, test
 * and translate later.
 */
export interface Rendered {
  subject: string;
  text: string;
  short: string;
}

interface Ctx {
  business: string;
}

export const templates = {
  "booking.received": (
    c: Ctx & { name: string; service: string; when: string; reference: string; statusUrl: string },
  ) => ({
    subject: `We've received your booking (${c.reference})`,
    text: `Hi ${c.name},\n\nThanks for booking ${c.service} for ${c.when}. We'll confirm the time and your technician shortly.\n\nReference: ${c.reference}\nTrack your booking: ${c.statusUrl}\n\n${c.business}`,
    short: `${c.business}: booking ${c.reference} received for ${c.when}. We'll confirm shortly. Track: ${c.statusUrl}`,
  }),
  "booking.new": (
    c: Ctx & {
      customer: string;
      phone: string;
      service: string;
      when: string;
      reference: string;
      url: string;
    },
  ) => ({
    subject: `New online booking: ${c.service}, ${c.when}`,
    text: `${c.customer} (${c.phone}) booked ${c.service} for ${c.when}.\n\nIt's in the "to schedule" tray on the dispatch board: ${c.url}\n\nReference: ${c.reference}`,
    short: `New booking ${c.reference}: ${c.customer}, ${c.service}, ${c.when}`,
  }),
  "job.scheduled": (
    c: Ctx & {
      name: string;
      service: string;
      when: string;
      technician: string | null;
      statusUrl: string | null;
    },
  ) => ({
    subject: `Confirmed: ${c.service} on ${c.when}`,
    text: `Hi ${c.name},\n\nYour ${c.service} is confirmed for ${c.when}${c.technician ? ` with ${c.technician}` : ""}.${c.statusUrl ? `\n\nDetails: ${c.statusUrl}` : ""}\n\n${c.business}`,
    short: `${c.business}: ${c.service} confirmed for ${c.when}${c.technician ? ` with ${c.technician}` : ""}.`,
  }),
  "job.en_route": (c: Ctx & { name: string; technician: string | null }) => ({
    subject: `${c.technician ?? "Your technician"} is on the way`,
    text: `Hi ${c.name},\n\n${c.technician ?? "Your technician"} from ${c.business} is on the way to you now.\n\n${c.business}`,
    short: `${c.business}: ${c.technician ?? "your technician"} is on the way.`,
  }),
  "job.completed": (c: Ctx & { name: string; service: string }) => ({
    subject: `${c.service} completed`,
    text: `Hi ${c.name},\n\nYour ${c.service} is complete. Thank you for choosing ${c.business}! Your invoice will follow.\n\n${c.business}`,
    short: `${c.business}: your ${c.service} is complete. Thank you!`,
  }),
  "job.cancelled": (c: Ctx & { name: string; service: string; when: string | null }) => ({
    subject: `${c.service} cancelled`,
    text: `Hi ${c.name},\n\nYour ${c.service}${c.when ? ` on ${c.when}` : ""} has been cancelled. Reply or call us to rebook.\n\n${c.business}`,
    short: `${c.business}: your ${c.service}${c.when ? ` on ${c.when}` : ""} was cancelled. Call us to rebook.`,
  }),
  "invoice.issued": (
    c: Ctx & { name: string; number: string; amount: string; due: string; url: string },
  ) => ({
    subject: `Invoice ${c.number} from ${c.business}`,
    text: `Hi ${c.name},\n\nYour invoice ${c.number} for ${c.amount} is due on ${c.due}.\n\nView and pay: ${c.url}\n\nThank you,\n${c.business}`,
    short: `${c.business}: invoice ${c.number} for ${c.amount}, due ${c.due}. View & pay: ${c.url}`,
  }),
  "invoice.overdue": (
    c: Ctx & { name: string; number: string; balance: string; daysLate: number; url: string },
  ) => ({
    subject: `Reminder: invoice ${c.number} is overdue`,
    text: `Hi ${c.name},\n\nInvoice ${c.number} (${c.balance}) was due ${c.daysLate} day${c.daysLate === 1 ? "" : "s"} ago.\n\nView and pay: ${c.url}\n\nIf you've already paid, please ignore this message.\n\n${c.business}`,
    short: `${c.business}: invoice ${c.number} (${c.balance}) is overdue. Pay: ${c.url}`,
  }),
  "stock.low": (
    c: Ctx & { item: string; sku: string; quantity: number; threshold: number; url: string },
  ) => ({
    subject: `Low stock: ${c.item}`,
    text: `${c.item} (${c.sku}) is down to ${c.quantity}, at or below its reorder level of ${c.threshold}.\n\nInventory: ${c.url}`,
    short: `Low stock: ${c.item} (${c.sku}) at ${c.quantity}.`,
  }),
} satisfies Record<string, (c: never) => Rendered>;

export type TemplateName = keyof typeof templates;
export type TemplateData<T extends TemplateName> = Omit<Parameters<(typeof templates)[T]>[0], "business">;
