import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { currentOrganizationId, Prisma } from "@opsdesk/db";
import type { Request, Response } from "express";
import { from, mergeMap, type Observable, of } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { AppException } from "./app-exception";

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const REPLAY_HEADER = "Idempotent-Replayed";

/**
 * Opt-in idempotency for authenticated writes: send `Idempotency-Key: <uuid>`
 * and a retry of the same request returns the stored response instead of
 * running again. The technician app attaches one to every queued offline
 * mutation, so a replay after a timeout (did it land or not?) is always safe.
 *
 * Choices:
 * - Only SUCCESSFUL responses are stored. A 409 isn't final: after the client
 *   resolves the conflict it may legitimately retry with the same key.
 * - The key is bound to method + route; reusing it for a different request is a client bug.
 * - Keys are per tenant (the table is tenant-scoped like everything else).
 * - Two truly simultaneous requests with one key can both run; the second
 *   insert loses on the unique index. The offline queue sends sequentially, and
 *   the endpoints it uses are idempotent by design too (client ids, S3 keys).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.header("idempotency-key");
    if (!key || !WRITE_METHODS.has(req.method) || !req.user) return next.handle();
    if (!KEY_FORMAT.test(key))
      throw new AppException("BAD_REQUEST", "Idempotency-Key must be 8-128 characters of [A-Za-z0-9_-]");

    const fingerprint = `${req.method} ${req.baseUrl}${req.path}`;
    const organizationId = currentOrganizationId();
    const existing = await this.prisma.db.idempotencyRecord.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new AppException(
          "BAD_REQUEST",
          "This Idempotency-Key was already used for a different request",
        );
      }
      res.setHeader(REPLAY_HEADER, "true");
      return of(existing.responseBody ?? undefined);
    }

    const statusCode =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === "POST" ? 201 : 200);
    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          this.prisma.db.idempotencyRecord
            .create({
              data: {
                organizationId,
                key,
                fingerprint,
                statusCode,
                responseBody: body === undefined ? Prisma.DbNull : (body as Prisma.InputJsonValue),
              },
            })
            .catch((e: unknown) => {
              // A concurrent request with the same key stored first: fine, ours already ran.
              if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
            })
            .then(() => body),
        ),
      ),
    );
  }
}
