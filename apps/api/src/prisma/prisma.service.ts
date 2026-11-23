import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, type TenantPrismaClient, withTenantIsolation } from "@opsdesk/db";

/**
 * Two handles on one connection pool:
 *  - `db`: tenant-scoped. Every feature module uses this. Isolation is automatic.
 *  - `unscoped`: bypasses isolation. Reserved for auth flows that run before a
 *    tenant is known (signup, login, invite acceptance). An ESLint rule blocks
 *    it everywhere else, so any new use shows up in code review.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly unscoped = new PrismaClient();
  readonly db: TenantPrismaClient = withTenantIsolation(this.unscoped);

  async onModuleDestroy(): Promise<void> {
    await this.unscoped.$disconnect();
  }
}

/** The client handed to `prisma.db.$transaction(async (tx) => ...)`: still tenant-scoped. */
export type TenantTx = Parameters<Parameters<TenantPrismaClient["$transaction"]>[0]>[0];
