import "reflect-metadata";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NestFactory } from "@nestjs/core";
import { getClientConfig } from "@opsdesk/client-config";
import { waitUntil } from "@vercel/functions";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { setBackgroundKeepAlive } from "./queue/queue.service";

/**
 * Entry point for serverless hosting (Vercel). The Nest app is created once
 * per warm instance and reused; every request goes to its Express handler.
 *
 * Differences from `main.ts` (a long-running server):
 *  - no WebSocket gateway: functions can't hold sockets, clients refetch instead;
 *  - background jobs run inline and are kept alive past the response with waitUntil;
 *  - scheduled work arrives as Vercel Cron HTTP calls (CronController).
 * Set SERVERLESS=true, STORAGE_DRIVER=database (or S3 settings) and the usual env.
 */
setBackgroundKeepAlive((work) => waitUntil(work));

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let ready: Promise<Handler> | undefined;

async function create(): Promise<Handler> {
  const nest = await NestFactory.create(AppModule.forRoot(getClientConfig(), { realtime: false }), {
    rawBody: true,
    logger: ["error", "warn", "log"],
  });
  const app = configureApp(nest);
  await app.init();
  return app.getHttpAdapter().getInstance() as Handler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  ready ??= create().catch((e: unknown) => {
    ready = undefined; // don't cache a failed boot
    throw e;
  });
  (await ready)(req, res);
}
