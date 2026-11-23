import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { getClientConfig } from "@opsdesk/client-config";
import { configureApp } from "./bootstrap";
import { ENV, type Env } from "./config/env";

// Local dev convenience: load the monorepo root .env. Real env vars always win.
const rootEnv = resolve(__dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function main(): Promise<void> {
  // Validates config/client.config.ts + env overrides; a bad value stops the boot with a readable error.
  const clientConfig = getClientConfig();
  const app = configureApp(
    await NestFactory.create(AppModule.forRoot(clientConfig), { bufferLogs: false, rawBody: true }),
  );
  const env = app.get<Env>(ENV);
  await app.listen(env.API_PORT);
  const enabled = Object.entries(clientConfig.features)
    .filter(([, on]) => on)
    .map(([f]) => f);
  Logger.log(
    `${clientConfig.branding.appName ?? clientConfig.business.name}: features [${enabled.join(", ")}]`,
    "Bootstrap",
  );
  Logger.log(`API on http://localhost:${env.API_PORT}/api  (docs: /api/docs)`, "Bootstrap");
}

void main();
