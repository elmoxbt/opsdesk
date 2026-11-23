import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CrossTenantWriteError, Prisma } from "@opsdesk/db";
import { describe, expect, it } from "vitest";
import { AppException } from "./app-exception";
import { toErrorResponse } from "./http-exception.filter";

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("db error", { code, clientVersion: "test" });

describe("toErrorResponse", () => {
  it("passes through AppException code, message and details", () => {
    const r = toErrorResponse(new AppException("VALIDATION_FAILED", "Invalid", { email: ["Required"] }));
    expect(r).toEqual({
      status: 400,
      body: { error: { code: "VALIDATION_FAILED", message: "Invalid", details: { email: ["Required"] } } },
    });
  });

  it("maps Nest HttpExceptions by status", () => {
    expect(toErrorResponse(new ForbiddenException()).body.error.code).toBe("FORBIDDEN");
    expect(toErrorResponse(new NotFoundException("nope")).body.error).toEqual({
      code: "NOT_FOUND",
      message: "nope",
    });
  });

  it.each([
    ["P2025", 404, "NOT_FOUND"],
    ["P2002", 409, "CONFLICT"],
    ["P2003", 400, "BAD_REQUEST"],
  ])("maps Prisma %s to %i", (code, status, errCode) => {
    const r = toErrorResponse(prismaError(code));
    expect(r.status).toBe(status);
    expect(r.body.error.code).toBe(errCode);
  });

  it("maps cross-tenant writes to 403", () => {
    expect(toErrorResponse(new CrossTenantWriteError("Customer")).status).toBe(403);
  });

  it("never leaks internal error messages", () => {
    const r = toErrorResponse(new Error("connection string postgres://secret@db"));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret");
  });
});
