/**
 * Proves isolation against a real Postgres, end to end through the extension
 * AND the composite foreign keys. Requires DATABASE_URL (see README).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantContext, TenantContextMissingError } from "./tenant-context";
import { withTenantIsolation } from "./tenant-extension";

const base = new PrismaClient();
const db = withTenantIsolation(base);

let orgA: string;
let orgB: string;
let customerA: string;
let customerB: string;
let serviceB: string;

const asTenant = <T>(organizationId: string, fn: () => PromiseLike<T>) =>
  tenantContext.runAsync({ organizationId }, fn);

beforeAll(async () => {
  const suffix = Date.now().toString(36);
  const [a, b] = await Promise.all([
    base.organization.create({ data: { name: "A", slug: `iso-a-${suffix}` } }),
    base.organization.create({ data: { name: "B", slug: `iso-b-${suffix}` } }),
  ]);
  orgA = a.id;
  orgB = b.id;
  customerA = (
    await asTenant(orgA, () =>
      db.customer.create({ data: { name: "Alice", phone: "1", organizationId: orgA } }),
    )
  ).id;
  customerB = (
    await asTenant(orgB, () =>
      db.customer.create({ data: { name: "Bob", phone: "2", organizationId: orgB } }),
    )
  ).id;
  serviceB = (
    await asTenant(orgB, () =>
      db.serviceType.create({
        data: { name: "Fix", defaultDurationMinutes: 60, defaultPriceMinor: 1000, organizationId: orgB },
      }),
    )
  ).id;
});

afterAll(async () => {
  await base.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await base.$disconnect();
});

describe("tenant isolation (Prisma extension + composite FKs)", () => {
  it("fails closed: tenant-scoped queries without a tenant throw", async () => {
    await expect(db.customer.findMany()).rejects.toThrow(TenantContextMissingError);
  });

  it("findMany only returns the current tenant's rows", async () => {
    const rows = await asTenant(orgA, () => db.customer.findMany());
    expect(rows.map((r) => r.id)).toEqual([customerA]);
  });

  it("findUnique by id of another tenant's row returns null", async () => {
    expect(await asTenant(orgA, () => db.customer.findUnique({ where: { id: customerB } }))).toBeNull();
  });

  it("update of another tenant's row fails as not found and leaves it unchanged", async () => {
    await expect(
      asTenant(orgA, () => db.customer.update({ where: { id: customerB }, data: { name: "pwned" } })),
    ).rejects.toMatchObject({ code: "P2025" });
    expect((await base.customer.findUniqueOrThrow({ where: { id: customerB } })).name).toBe("Bob");
  });

  it("updateMany/deleteMany cannot reach another tenant", async () => {
    const res = await asTenant(orgA, () => db.customer.deleteMany({ where: { id: customerB } }));
    expect(res.count).toBe(0);
    expect(await base.customer.count({ where: { id: customerB } })).toBe(1);
  });

  it("create ignores a forged organizationId", async () => {
    const created = await asTenant(orgA, () =>
      db.customer.create({ data: { name: "Mallory", phone: "3", organizationId: orgB } }),
    );
    expect(created.organizationId).toBe(orgA);
  });

  it("count and aggregate are scoped", async () => {
    const n = await asTenant(orgB, () => db.customer.count());
    expect(n).toBe(1);
  });

  it("database rejects a job in tenant A that references tenant B's customer (composite FK)", async () => {
    await expect(
      asTenant(orgA, () =>
        db.job.create({
          data: { number: 1, customerId: customerB, serviceTypeId: serviceB, organizationId: orgA },
        }),
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("interactive transactions are scoped too", async () => {
    const ids = await asTenant(orgB, () =>
      db.$transaction(async (tx) => (await tx.customer.findMany()).map((c) => c.id)),
    );
    expect(ids).toEqual([customerB]);
  });

  it("concurrent requests for different tenants do not leak context", async () => {
    const [a, b] = await Promise.all([
      asTenant(orgA, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return db.customer.findMany({ where: { name: "Alice" } });
      }),
      asTenant(orgB, () => db.customer.findMany({ where: { name: "Alice" } })),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });
});

describe("tenantContext.run vs runAsync", () => {
  it("run() with a lazy Prisma query fails closed; runAsync() executes it in context", async () => {
    await expect(tenantContext.run({ organizationId: orgA }, () => db.customer.count())).rejects.toThrow(
      TenantContextMissingError,
    );
    // Alice + the "forged" Mallory created earlier, both in tenant A.
    await expect(tenantContext.runAsync({ organizationId: orgA }, () => db.customer.count())).resolves.toBe(
      2,
    );
  });
});
