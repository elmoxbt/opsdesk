import { describe, expect, it } from "vitest";
import {
  ClientConfigError,
  defineClientConfig,
  featureEnvName,
  readableForeground,
  resolveClientConfig,
  toPublicConfig,
} from "./resolve";

const base = defineClientConfig({
  business: {
    name: "Brightline Home Services",
    slug: "brightline",
    email: "hello@brightline.test",
    timezone: "Africa/Lagos",
    currency: "ngn",
  },
  branding: { primaryColor: "#4f46e5" },
  features: {
    inventory: true,
    payments: false,
    bookingPortal: true,
    technicianApp: true,
    analytics: true,
    publicApi: false,
  },
  owner: { name: "Ada Okafor", email: "ada@brightline.test" },
  domains: { app: "app.brightline.test" },
});

describe("resolveClientConfig", () => {
  it("applies defaults and normalises values", () => {
    const c = resolveClientConfig(base, {});
    expect(c.business.currency).toBe("NGN");
    expect(c.business.locale).toBe("en-NG");
    expect(c.business.taxRateBps).toBe(0);
  });

  it.each([
    ["branding colour", { branding: { primaryColor: "indigo" } }, /hex colour/],
    ["time zone", { business: { ...base.business, timezone: "Mars/Olympus" } }, /time zone/],
    ["currency", { business: { ...base.business, currency: "XQZ" } }, /currency/],
    ["domain with scheme", { domains: { app: "https://app.x.com" } }, /hostname/],
  ])("rejects an invalid %s with a readable message", (_, patch, msg) => {
    expect(() => resolveClientConfig({ ...base, ...patch } as typeof base, {})).toThrow(msg);
  });

  it("requires a payment provider when payments are enabled", () => {
    expect(() =>
      resolveClientConfig({ ...base, features: { ...base.features, payments: true } }, {}),
    ).toThrow(/payments/);
    expect(
      resolveClientConfig(
        { ...base, features: { ...base.features, payments: true }, payments: { provider: "paystack" } },
        {},
      ).payments,
    ).toEqual({
      provider: "paystack",
    });
  });

  it("lets env override branding, settings and features", () => {
    const c = resolveClientConfig(base, {
      CLIENT_APP_NAME: "Brightline Ops",
      CLIENT_PRIMARY_COLOR: "#0f766e",
      CLIENT_TIMEZONE: "Europe/London",
      FEATURE_INVENTORY: "false",
      FEATURE_PUBLIC_API: "true",
    });
    expect(c.branding).toMatchObject({ appName: "Brightline Ops", primaryColor: "#0f766e" });
    expect(c.business.timezone).toBe("Europe/London");
    expect(c.features).toMatchObject({ inventory: false, publicApi: true });
  });

  it("validates env overrides too, and says where the bad value came from", () => {
    expect(() => resolveClientConfig(base, { CLIENT_PRIMARY_COLOR: "red" })).toThrow(/CLIENT_PRIMARY_COLOR/);
    expect(() => resolveClientConfig(base, { FEATURE_ANALYTICS: "yes" })).toThrow(ClientConfigError);
  });

  it("never mutates the file config", () => {
    resolveClientConfig(base, { CLIENT_APP_NAME: "X" });
    expect(base.branding.appName).toBeUndefined();
  });
});

describe("helpers", () => {
  it("maps feature names to env var names", () => {
    expect(featureEnvName("bookingPortal")).toBe("FEATURE_BOOKING_PORTAL");
    expect(featureEnvName("inventory")).toBe("FEATURE_INVENTORY");
  });

  it("picks a readable foreground for the brand colour", () => {
    expect(readableForeground("#4f46e5")).toBe("#ffffff");
    expect(readableForeground("#fde047")).toBe("#0a0a0a");
  });

  it("public config omits the owner and fills appName", () => {
    const pub = toPublicConfig(resolveClientConfig(base, {}));
    expect(pub.appName).toBe("Brightline Home Services");
    expect(JSON.stringify(pub)).not.toContain("ada@brightline.test");
  });
});
