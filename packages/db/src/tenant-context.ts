import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped tenant context.
 *
 * The HTTP layer opens an empty store for every request (`run({}, next)`), and
 * the auth guard fills it in once the caller is known (`set(...)`). Because the
 * store object is shared by reference, everything awaited later in that request
 * (services, Prisma queries) sees the same values without passing them around.
 */
export interface TenantStore {
  organizationId?: string;
  userId?: string;
  role?: string;
  /** Set instead of userId when the caller is an API key (audit shows API_KEY). */
  apiKeyId?: string;
}

export class TenantContextMissingError extends Error {
  constructor() {
    super(
      "No tenant in context. Tenant-scoped queries must run inside an authenticated request " +
        "or tenantContext.run({ organizationId }, ...). Use the unscoped client only for auth/system work.",
    );
    this.name = "TenantContextMissingError";
  }
}

const storage = new AsyncLocalStorage<TenantStore>();

export const tenantContext = {
  /** Synchronous entry point, used by the HTTP middleware around `next()`. */
  run<T>(store: TenantStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /**
   * Use this for background jobs, scripts and tests. Prisma queries are lazy:
   * they execute only when awaited. `run(ctx, () => db.x.findMany())` would hand
   * back an un-started query that later executes OUTSIDE the context (and fails
   * closed). Awaiting inside the store guarantees the query runs in context.
   */
  runAsync<T>(store: TenantStore, fn: () => PromiseLike<T>): Promise<T> {
    return storage.run(store, async () => await fn());
  },

  get(): Readonly<TenantStore> | undefined {
    return storage.getStore();
  },

  /** Fill in the current request's store. Throws if called outside `run`. */
  set(values: TenantStore): void {
    const store = storage.getStore();
    if (!store) throw new Error("tenantContext.set() called outside tenantContext.run()");
    Object.assign(store, values);
  },

  requireOrganizationId(): string {
    const id = storage.getStore()?.organizationId;
    if (!id) throw new TenantContextMissingError();
    return id;
  },
};
