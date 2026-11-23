/**
 * White-label configuration for THIS deployment (one business per deployment).
 *
 * - Everything here is validated by the schema in @opsdesk/config; a bad value
 *   fails the image build and the API boot with a readable error.
 * - Selected values can be overridden per environment with env vars
 *   (CLIENT_*, FEATURE_*); see docs/deploying-a-client.md.
 * - Secrets NEVER go here: they live in the deployment's .env.
 *
 * Example client. Copy this folder to clients/<name>/, edit both files, then run:
 *   ./scripts/deploy-client.sh <name>
 */
import { defineClientConfig } from "@opsdesk/config";

export default defineClientConfig({
  business: {
    name: "Acme Plumbing",
    slug: "acme-plumbing",
    email: "hello@acme-plumbing.example",
    phone: "+234 800 000 0001",
    address: "3 Herbert Macaulay Way, Yaba, Lagos",
    timezone: "Africa/Lagos",
    currency: "NGN",
    locale: "en-NG",
    taxRateBps: 750,
  },
  branding: {
    appName: "Acme Plumbing",
    primaryColor: "#0f766e",
    tagline: "Leaks fixed today.",
  },
  features: {
    inventory: false,
    payments: true,
    bookingPortal: true,
    technicianApp: true,
    analytics: false,
    publicApi: false,
  },
  payments: { provider: "paystack" },
  invoicing: {
    paymentTermsDays: 14,
    partsMarkupBps: 1500, // parts billed at cost + 15%
    footer: "Bank transfer: GTBank 0123456789. Please use the invoice number as the reference.",
  },
  // Public booking page (https://<domain>/book/acme-plumbing). Times in business.timezone.
  booking: {
    hours: {
      mon: ["07:30", "18:00"],
      tue: ["07:30", "18:00"],
      wed: ["07:30", "18:00"],
      thu: ["07:30", "18:00"],
      fri: ["07:30", "18:00"],
      sat: ["09:00", "13:00"],
      sun: null,
    },
    slotMinutes: 60,
    leadTimeHours: 4,
    horizonDays: 21,
  },
  // Customer messages: email always (when we have an address); SMS once a gateway is configured.
  notifications: { email: true, sms: true, whatsapp: false },
  owner: { name: "Ada Okafor", email: "owner@acme-plumbing.example" },
  domains: { app: "app.acme-plumbing.example" },
});
