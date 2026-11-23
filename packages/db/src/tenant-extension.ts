import { Prisma, type PrismaClient } from "@prisma/client";
import { tenantContext } from "./tenant-context";

/**
 * Models that carry `organizationId`, derived from the schema itself so a new
 * tenant-owned model is protected automatically: there is no list to forget.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "organizationId"))
    .map((m) => m.name),
);

export class CrossTenantWriteError extends Error {
  constructor(model: string) {
    super(`Refusing to change organizationId on ${model}: rows cannot move between tenants.`);
    this.name = "CrossTenantWriteError";
  }
}

type Args = Record<string, unknown>;

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

function isRecord(v: unknown): v is Args {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertNoTenantChange(model: string, data: unknown, organizationId: string): void {
  if (isRecord(data) && "organizationId" in data && data.organizationId !== organizationId) {
    throw new CrossTenantWriteError(model);
  }
}

/**
 * Pure function: rewrites Prisma operation args so they can only touch rows of
 * `organizationId`. Exported for unit tests.
 *
 * - Reads/updates/deletes: `organizationId` is AND-ed into `where`. Prisma 5+
 *   accepts extra filters on unique `where` inputs, so `findUnique({ where: { id } })`
 *   of another tenant's row simply returns null (and update/delete throw P2025 "not found"),
 *   which never reveals the row exists.
 * - Creates: `organizationId` is forced onto the data, overriding any caller value.
 * - Updates: changing `organizationId` is rejected outright.
 */
export function scopeArgs(model: string, operation: string, rawArgs: unknown, organizationId: string): Args {
  const args: Args = isRecord(rawArgs) ? { ...rawArgs } : {};

  if (WHERE_OPERATIONS.has(operation)) {
    const where = isRecord(args.where) ? args.where : {};
    args.where = { ...where, organizationId };
  }

  switch (operation) {
    case "create":
      args.data = { ...(isRecord(args.data) ? args.data : {}), organizationId };
      break;
    case "createMany":
    case "createManyAndReturn": {
      const rows: unknown[] = Array.isArray(args.data) ? args.data : [args.data];
      args.data = rows.map((row) => ({ ...(isRecord(row) ? row : {}), organizationId }));
      break;
    }
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      assertNoTenantChange(model, args.data, organizationId);
      break;
    case "upsert":
      assertNoTenantChange(model, args.update, organizationId);
      args.create = { ...(isRecord(args.create) ? args.create : {}), organizationId };
      break;
  }

  return args;
}

/**
 * Prisma client extension enforcing row-level tenant isolation. This is the ONE
 * place isolation is implemented; services never write `where: { organizationId }`.
 *
 * It is fail-closed: a tenant-scoped query with no tenant in context throws
 * instead of silently returning every tenant's rows.
 *
 * Not covered (documented, and avoided by convention): `$queryRaw`/`$executeRaw`,
 * and nested writes into tenant models through an *optional* relation. Required
 * relations between tenant models use composite FKs (id, organizationId), so the
 * database rejects cross-tenant links there regardless.
 */
export function tenantIsolation(getOrganizationId: () => string = tenantContext.requireOrganizationId) {
  return Prisma.defineExtension({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) return query(args);
          const scoped = scopeArgs(model, operation, args, getOrganizationId());
          return query(scoped as typeof args);
        },
      },
    },
  });
}

export function withTenantIsolation(client: PrismaClient) {
  return client.$extends(tenantIsolation());
}

export type TenantPrismaClient = ReturnType<typeof withTenantIsolation>;

/**
 * Prisma's generated types still require `organizationId` on create. Pass this:
 *   db.customer.create({ data: { ...input, organizationId: currentOrganizationId() } })
 * The extension overwrites it with the same value anyway, so it can never be wrong.
 */
export const currentOrganizationId = (): string => tenantContext.requireOrganizationId();
