import { z } from "zod";
import {
  type ClientConfig,
  type ClientConfigInput,
  clientConfigSchema,
  type Feature,
  FEATURES,
} from "./schema";

/** Typed authoring helper for client.config.ts: autocomplete + compile-time checks. */
export const defineClientConfig = (config: ClientConfigInput): ClientConfigInput => config;

/**
 * Env vars that may override the config file, and where they land. Explicit on
 * purpose: one table to read, instead of guessing what a deep-merge will do.
 * Secrets never go in client.config.ts, only in env.
 */
export const ENV_OVERRIDES: Readonly<Record<string, readonly [string, string]>> = {
  CLIENT_BUSINESS_NAME: ["business", "name"],
  CLIENT_BUSINESS_EMAIL: ["business", "email"],
  CLIENT_BUSINESS_PHONE: ["business", "phone"],
  CLIENT_TIMEZONE: ["business", "timezone"],
  CLIENT_CURRENCY: ["business", "currency"],
  CLIENT_LOCALE: ["business", "locale"],
  CLIENT_APP_NAME: ["branding", "appName"],
  CLIENT_PRIMARY_COLOR: ["branding", "primaryColor"],
  CLIENT_LOGO_URL: ["branding", "logoUrl"],
  CLIENT_APP_DOMAIN: ["domains", "app"],
};

/** FEATURE_BOOKING_PORTAL ↔ bookingPortal */
export const featureEnvName = (f: Feature): string =>
  `FEATURE_${f.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

export class ClientConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientConfigError";
  }
}

/**
 * file config + env overrides → validated ClientConfig. Throws a readable
 * ClientConfigError (with where each bad value came from), so a misconfigured
 * deployment fails at boot/build instead of misbehaving later.
 */
export function resolveClientConfig(
  fileConfig: ClientConfigInput,
  env: Record<string, string | undefined> = process.env,
): ClientConfig {
  const merged = structuredClone(fileConfig) as Record<string, Record<string, unknown>>;
  const fromEnv: string[] = [];

  for (const [name, [section, key]] of Object.entries(ENV_OVERRIDES)) {
    const value = env[name];
    if (value === undefined || value === "") continue;
    merged[section] = { ...(merged[section] ?? {}), [key]: value };
    fromEnv.push(`${section}.${key} ← ${name}`);
  }
  for (const f of FEATURES) {
    const name = featureEnvName(f);
    const value = env[name];
    if (value === undefined || value === "") continue;
    if (value !== "true" && value !== "false")
      throw new ClientConfigError(`${name} must be "true" or "false", got "${value}"`);
    merged.features = { ...(merged.features ?? {}), [f]: value === "true" };
    fromEnv.push(`features.${f} ← ${name}`);
  }

  const result = clientConfigSchema.safeParse(merged);
  if (!result.success) {
    const where = fromEnv.length ? `\n\nEnv overrides applied:\n  ${fromEnv.join("\n  ")}` : "";
    throw new ClientConfigError(
      `Invalid client config (config/client.config.ts + env):\n${z.prettifyError(result.error)}${where}`,
    );
  }
  return result.data;
}

export const isFeatureEnabled = (config: ClientConfig, feature: Feature): boolean => config.features[feature];

/** Safe to send to browsers: no owner details, nothing deployment-internal. */
export interface PublicClientConfig {
  appName: string;
  business: Pick<
    ClientConfig["business"],
    "name" | "email" | "phone" | "website" | "timezone" | "currency" | "locale" | "taxRateBps"
  >;
  branding: ClientConfig["branding"] & { primaryForeground: string };
  features: Record<Feature, boolean>;
}

export function toPublicConfig(c: ClientConfig): PublicClientConfig {
  const { name, email, phone, website, timezone, currency, locale, taxRateBps } = c.business;
  return {
    appName: c.branding.appName ?? c.business.name,
    business: { name, email, phone, website, timezone, currency, locale, taxRateBps },
    branding: { ...c.branding, primaryForeground: readableForeground(c.branding.primaryColor) },
    features: { ...c.features },
  };
}

/** Text colour for a brand-coloured button: whichever of near-white/near-black has more WCAG contrast. */
export function readableForeground(hex: string): string {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const contrastWithWhite = 1.05 / (lum + 0.05);
  const contrastWithBlack = (lum + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? "#ffffff" : "#0a0a0a";
}
