/**
 * White-label configuration for THIS deployment (one business per deployment).
 *
 * - Everything here is validated by the schema in @opsdesk/config; a bad value
 *   fails the image build and the API boot with a readable error.
 * - Selected values can be overridden per environment with env vars
 *   (CLIENT_*, FEATURE_*); see docs/deploying-a-client.md.
 * - Secrets NEVER go here: they live in the deployment's .env.
 *
 * This file is the local demo client. Real clients keep their own copy in
 * clients/<name>/client.config.ts, which the deploy script builds into their image.
 */
import { defineClientConfig } from "@opsdesk/config";

export default defineClientConfig({
  business: {
    name: "Brightline Home Services",
    slug: "brightline",
    email: "hello@brightline.example",
    phone: "+234 800 000 0000",
    address: "14 Admiralty Way, Lekki Phase 1, Lagos",
    timezone: "Africa/Lagos",
    currency: "NGN",
    locale: "en-NG",
    taxRateBps: 750,
  },
  branding: {
    appName: "Brightline Ops",
    primaryColor: "#4f46e5",
    tagline: "Home services, handled.",
  },
  features: {
    inventory: true,
    payments: true,
    bookingPortal: true,
    technicianApp: true,
    analytics: true,
    publicApi: true,
  },
  payments: { provider: "paystack" },
  invoicing: {
    paymentTermsDays: 14,
    partsMarkupBps: 1500, // parts billed at cost + 15%
    footer: "Bank transfer: GTBank 0123456789. Please use the invoice number as the reference.",
  },
  owner: { name: "Ada Okafor", email: "owner@brightline.example" },
  domains: { app: "localhost" },
});
