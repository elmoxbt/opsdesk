import { describe, expect, it } from "vitest";
import { CrossTenantWriteError, scopeArgs, TENANT_SCOPED_MODELS } from "./tenant-extension";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("TENANT_SCOPED_MODELS", () => {
  it("includes every model with organizationId and excludes the tenant root + auth tables", () => {
    expect(TENANT_SCOPED_MODELS.has("Customer")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("Job")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("AuditLog")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("Organization")).toBe(false);
    expect(TENANT_SCOPED_MODELS.has("RefreshToken")).toBe(false);
  });
});

describe("scopeArgs", () => {
  it.each(["findMany", "findFirst", "findUnique", "count", "updateMany", "deleteMany", "delete"])(
    "adds organizationId to where for %s",
    (op) => {
      const out = scopeArgs("Customer", op, { where: { id: "x" } }, ORG);
      expect(out.where).toEqual({ id: "x", organizationId: ORG });
    },
  );

  it("adds a where clause when none was provided", () => {
    expect(scopeArgs("Customer", "findMany", undefined, ORG).where).toEqual({ organizationId: ORG });
  });

  it("overrides a caller-supplied organizationId in where (cannot query another tenant)", () => {
    const out = scopeArgs("Customer", "findMany", { where: { organizationId: OTHER } }, ORG);
    expect(out.where).toEqual({ organizationId: ORG });
  });

  it("forces organizationId on create, even if the caller passed another tenant", () => {
    const out = scopeArgs("Customer", "create", { data: { name: "A", organizationId: OTHER } }, ORG);
    expect(out.data).toEqual({ name: "A", organizationId: ORG });
  });

  it("stamps every row in createMany", () => {
    const out = scopeArgs("Customer", "createMany", { data: [{ name: "A" }, { name: "B" }] }, ORG);
    expect(out.data).toEqual([
      { name: "A", organizationId: ORG },
      { name: "B", organizationId: ORG },
    ]);
  });

  it("rejects moving a row to another tenant on update", () => {
    expect(() =>
      scopeArgs("Customer", "update", { where: { id: "x" }, data: { organizationId: OTHER } }, ORG),
    ).toThrow(CrossTenantWriteError);
  });

  it("scopes both where and create for upsert", () => {
    const out = scopeArgs(
      "Customer",
      "upsert",
      { where: { id: "x" }, create: { name: "A" }, update: {} },
      ORG,
    );
    expect(out.where).toEqual({ id: "x", organizationId: ORG });
    expect(out.create).toEqual({ name: "A", organizationId: ORG });
  });

  it("does not mutate the caller's args object", () => {
    const args = { where: { id: "x" } };
    scopeArgs("Customer", "findFirst", args, ORG);
    expect(args).toEqual({ where: { id: "x" } });
  });
});
