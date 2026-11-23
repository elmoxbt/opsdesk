import { z } from "zod";

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/**
 * What a key may do. Least privilege by default: an integration that only
 * reads jobs gets `jobs:read`, nothing else. Keys never manage users,
 * settings, money or other keys.
 */
export const API_SCOPES = [
  "jobs:read",
  "jobs:write",
  "customers:read",
  "customers:write",
  "invoices:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  "jobs:read": "Read jobs and services",
  "jobs:write": "Create, schedule and update jobs",
  "customers:read": "Read customers",
  "customers:write": "Create and update customers",
  "invoices:read": "Read invoices",
};

export const apiKeyInputSchema = z.object({
  name: z.string().trim().min(2, "Name it after the integration (e.g. Zapier)").max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Choose at least one permission"),
  /** Optional expiry in days from now. */
  expiresInDays: z.coerce.number().int().min(1).max(730).nullish(),
});
export type ApiKeyInput = z.input<typeof apiKeyInputSchema>;

/** "opsk_" + 12-char public prefix + "_" + 32-char secret. The prefix finds the row; the secret is only stored hashed. */
export const API_KEY_PATTERN = /^opsk_([A-Za-z0-9]{12})_([A-Za-z0-9_-]{32,64})$/;

// ---------------------------------------------------------------------------
// Outgoing webhooks
// ---------------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  "job.created",
  "job.updated",
  "job.rescheduled",
  "job.status_changed",
  "invoice.paid",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  "job.created": "A job is created (including online bookings)",
  "job.updated": "A job's details change",
  "job.rescheduled": "A job is assigned or moved",
  "job.status_changed": "A job changes status",
  "invoice.paid": "An invoice receives a payment",
};

export const webhookEndpointInputSchema = z.object({
  url: z
    .url({ protocol: /^https?$/, message: "Enter a full URL, e.g. https://example.com/hooks/opsdesk" })
    .max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choose at least one event"),
  description: z.string().trim().max(200).nullish(),
  isActive: z.boolean().default(true),
});
export type WebhookEndpointInput = z.input<typeof webhookEndpointInputSchema>;
