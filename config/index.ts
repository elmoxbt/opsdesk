import {
  type ClientConfig,
  type PublicClientConfig,
  resolveClientConfig,
  toPublicConfig,
} from "@opsdesk/config";
import fileConfig from "./client.config";

/** Validates client.config.ts + env overrides. Throws ClientConfigError with details. */
export function loadClientConfig(env: Record<string, string | undefined> = process.env): ClientConfig {
  return resolveClientConfig(fileConfig, env);
}

let cached: ClientConfig | undefined;
/** Process-wide config, resolved once from the real environment. */
export function getClientConfig(): ClientConfig {
  cached ??= loadClientConfig();
  return cached;
}

export const getPublicClientConfig = (): PublicClientConfig => toPublicConfig(getClientConfig());

export type { ClientConfig, PublicClientConfig } from "@opsdesk/config";
export { FEATURES, type Feature } from "@opsdesk/config";
