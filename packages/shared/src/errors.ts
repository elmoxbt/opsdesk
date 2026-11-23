import type { ScheduleConflictDto } from "./dto";

/**
 * Every non-2xx API response has this shape. Frontends can rely on `code`
 * (machine-readable) and show `message` (human-readable).
 */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level validation issues, keyed by dotted path. */
    details?: Record<string, string[]>;
    /** Present on scheduling 409s: the jobs in the way. */
    conflicts?: ScheduleConflictDto[];
    requestId?: string;
  };
}
