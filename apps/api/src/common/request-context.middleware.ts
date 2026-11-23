import { randomUUID } from "node:crypto";
import { tenantContext } from "@opsdesk/db";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID = /^[\w-]{8,64}$/;

/**
 * Runs first on every request:
 *  1. assigns a request id (honouring a sane incoming X-Request-Id) for log correlation;
 *  2. opens an empty tenant context that the auth guard fills in. Everything
 *     downstream, including Prisma queries, runs inside this async context.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  req.id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", req.id);
  tenantContext.run({}, next);
}
