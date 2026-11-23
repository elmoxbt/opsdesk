/**
 * Validate a client's config + .env overrides without deploying:
 *   pnpm client:check <name>
 * The file is copied next to this package first, so its `@opsdesk/config`
 * import resolves exactly as it will inside the Docker build.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ClientConfigInput, FEATURES, featureEnvName, resolveClientConfig } from "@opsdesk/config";

function parseDotenv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error("Usage: pnpm client:check <client-name>");
  const dir = resolve(__dirname, "..", "clients", name);
  const file = join(dir, "client.config.ts");
  if (!existsSync(file)) throw new Error(`Not found: clients/${name}/client.config.ts`);

  const tmp = join(__dirname, ".check");
  mkdirSync(tmp, { recursive: true });
  copyFileSync(file, join(tmp, "client.config.ts"));
  const mod = (await import(pathToFileURL(join(tmp, "client.config.ts")).href)) as {
    default: ClientConfigInput;
  };

  const envFile = existsSync(join(dir, ".env")) ? join(dir, ".env") : join(dir, ".env.example");
  const config = resolveClientConfig(mod.default, parseDotenv(envFile));

  console.log(`✔ clients/${name} is valid (env: ${envFile.endsWith(".example") ? ".env.example" : ".env"})`);
  console.log(
    `  ${config.branding.appName ?? config.business.name} · https://${config.domains.app} · ${config.business.currency} · ${config.business.timezone}`,
  );
  for (const f of FEATURES)
    console.log(`  ${config.features[f] ? "on " : "off"}  ${f.padEnd(14)} (${featureEnvName(f)})`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
