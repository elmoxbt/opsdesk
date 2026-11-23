import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { CrossTenantWriteError, Prisma } from "@opsdesk/db";
import type { ApiErrorBody, ErrorCode } from "@opsdesk/shared";
import type { Request, Response } from "express";
import { AppException } from "./app-exception";

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

/**
 * The exclusion constraint (migration no_double_booking) is the race-proof
 * backstop behind the service-level overlap check. Postgres raises 23P01;
 * Prisma surfaces it with the constraint name in the message.
 */
export function isDoubleBooking(e: unknown): boolean {
  return e instanceof Error && /Job_technician_no_overlap|23P01|exclusion constraint/i.test(e.message);
}

/** Maps any thrown value to `{ status, body }`. Pure, so it is unit-testable. */
export function toErrorResponse(exception: unknown): { status: number; body: ApiErrorBody } {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      body: {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          ...(exception.conflicts && { conflicts: exception.conflicts }),
        },
      },
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    const message =
      typeof res === "object" && res !== null && "message" in res
        ? String(Array.isArray(res.message) ? res.message.join(", ") : res.message)
        : exception.message;
    return {
      status,
      body: {
        error: { code: CODE_BY_STATUS[status] ?? (status >= 500 ? "INTERNAL" : "BAD_REQUEST"), message },
      },
    };
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025: row not found (including rows hidden by tenant scoping).
    if (exception.code === "P2025") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "Resource not found" } } };
    }
    if (exception.code === "P2002") {
      return { status: 409, body: { error: { code: "CONFLICT", message: "Resource already exists" } } };
    }
    // P2003: FK violation, e.g. a composite (id, organizationId) FK rejecting another tenant's id.
    if (exception.code === "P2003") {
      return {
        status: 400,
        body: { error: { code: "BAD_REQUEST", message: "Referenced resource not found" } },
      };
    }
  }
  if (isDoubleBooking(exception)) {
    return {
      status: 409,
      body: {
        error: {
          code: "CONFLICT",
          message: "That technician was just booked at this time by someone else. Refresh and try again.",
        },
      },
    };
  }
  if (exception instanceof CrossTenantWriteError) {
    return { status: 403, body: { error: { code: "FORBIDDEN", message: "Forbidden" } } };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { error: { code: "INTERNAL", message: "Something went wrong" } },
  };
}

/**
 * Single, consistent error format for the whole API. Stack traces and internal
 * messages are logged server-side only, never sent to clients.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpException");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const { status, body } = toErrorResponse(exception);
    body.error.requestId = req.id;

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} [${req.id ?? "-"}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    res.status(status).json(body);
  }
}
