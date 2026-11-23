import { Prisma } from "@opsdesk/db";
import type { ErrorCode } from "@opsdesk/shared";
import { AppException } from "./app-exception";

export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const pageArgs = ({ page, pageSize }: { page: number; pageSize: number }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

/** Turn a unique-constraint violation into a friendly, field-level 409. */
export function rethrowUnique(e: unknown, field: string, message: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new AppException("CONFLICT", message, { [field]: [message] });
  }
  throw e;
}

export function invalidField(
  field: string,
  message: string,
  code: ErrorCode = "VALIDATION_FAILED",
): AppException {
  return new AppException(code, message, { [field]: [message] });
}
