import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { getClientConfig } from "@opsdesk/client-config";
import { AppModule } from "./app.module";

/**
 * Background-job process (`opsdesk worker`): PDFs, overdue reminders, and later
 * notifications and outgoing webhooks. Same code and config as the API, no
 * HTTP server; scale it separately and a slow PDF never blocks a request.
 */
const rootEnv = resolve(__dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
process.env.RUN_WORKER = "true";

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot(getClientConfig(), { worker: true }),
  );
  app.enableShutdownHooks(); // SIGTERM: finish in-flight jobs, then exit (BullMQ hands the rest to the next worker)
  Logger.log("Worker started", "Worker");
}

void main();
