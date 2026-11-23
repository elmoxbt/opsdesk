import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@opsdesk/shared";
import { describe, expect, it } from "vitest";
import { AppException } from "../common/app-exception";
import { RolesGuard } from "./roles.guard";

function contextFor(role: Role | undefined, required: Role[] | undefined): [RolesGuard, ExecutionContext] {
  const reflector = new Reflector();
  reflector.getAllAndOverride = () => required as never;
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { id: "u", organizationId: "o", role } : undefined }),
    }),
  } as unknown as ExecutionContext;
  return [new RolesGuard(reflector), ctx];
}

describe("RolesGuard", () => {
  it("allows any authenticated user when no roles are required", () => {
    const [guard, ctx] = contextFor("TECHNICIAN", undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("allows a user whose role is listed", () => {
    const [guard, ctx] = contextFor("DISPATCHER", ["OWNER", "DISPATCHER"]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it.each<Role>(["DISPATCHER", "TECHNICIAN"])("forbids %s from an OWNER-only route", (role) => {
    const [guard, ctx] = contextFor(role, ["OWNER"]);
    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it("forbids when there is no user", () => {
    const [guard, ctx] = contextFor(undefined, ["OWNER"]);
    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });
});
