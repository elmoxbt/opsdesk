import { HttpException, HttpStatus } from "@nestjs/common";
import type { ErrorCode, ScheduleConflictDto } from "@opsdesk/shared";

const STATUS: Record<ErrorCode, HttpStatus> = {
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Throw this from services for any expected, client-facing error. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, string[]>,
    readonly conflicts?: ScheduleConflictDto[],
  ) {
    super({ code, message, details }, STATUS[code]);
  }
}
