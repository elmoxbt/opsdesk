/**
 * Creates (first deploy) or syncs (every deploy) THE organization this
 * deployment serves, from config/client.config.ts, plus its OWNER account.
 *
 *   pnpm db:bootstrap                      (dev)
 *   node packages/db/dist/bootstrap.js     (production image, via deploy-client.sh)
 *
 * Idempotent. Never overwrites an existing owner's password. Refuses to run
 * against a database that already belongs to a different business, which catches
 * a pasted-wrong DATABASE_URL before it does damage.
 */
import type { ClientConfig } from "@opsdesk/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

export interface BootstrapOptions {
  /** Required only when the owner doesn't exist yet. */
  ownerPassword?: string;
  bcryptRounds?: number;
}

export interface BootstrapResult {
  organizationId: string;
  organizationCreated: boolean;
  ownerCreated: boolean;
  /** Settings that changed because client.config.ts changed since the last deploy. */
  changed: string[];
}

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapError";
  }
}

export async function bootstrapOrganization(
  prisma: PrismaClient,
  config: ClientConfig,
  opts: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const settings = {
    name: config.business.name,
    brandColor: config.branding.primaryColor,
    currency: config.business.currency,
    timezone: config.business.timezone,
    logoUrl: config.branding.logoUrl ?? null,
  };
  const passwordHash = opts.ownerPassword ? await hash(opts.ownerPassword, opts.bcryptRounds ?? 12) : null;

  return prisma.$transaction(async (tx) => {
    const orgs = await tx.organization.findMany({
      select: { id: true, slug: true, ...selectKeys(settings) },
      take: 2,
    });
    const existing = orgs.find((o) => o.slug === config.business.slug);
    if (!existing && orgs.length > 0) {
      throw new BootstrapError(
        `This database already belongs to "${orgs[0]!.slug}". One deployment serves one business; refusing to create "${config.business.slug}". Check DATABASE_URL.`,
      );
    }

    const changed = existing
      ? (Object.keys(settings) as Array<keyof typeof settings>).filter((k) => existing[k] !== settings[k])
      : [];
    const org = existing
      ? await tx.organization.update({ where: { id: existing.id }, data: settings })
      : await tx.organization.create({ data: { slug: config.business.slug, ...settings } });

    let ownerCreated = false;
    const owner = await tx.user.findFirst({
      where: { organizationId: org.id, role: "OWNER" },
      select: { id: true },
    });
    if (!owner) {
      if (!passwordHash || (opts.ownerPassword?.length ?? 0) < 10) {
        throw new BootstrapError(
          "OWNER_INITIAL_PASSWORD (at least 10 characters) is required to create the owner account.",
        );
      }
      const emailTaken = await tx.user.findUnique({
        where: { email: config.owner.email },
        select: { id: true },
      });
      if (emailTaken)
        throw new BootstrapError(
          `A user with ${config.owner.email} already exists but isn't this business's owner.`,
        );
      await tx.user.create({
        data: {
          organizationId: org.id,
          email: config.owner.email,
          name: config.owner.name,
          role: "OWNER",
          passwordHash,
        },
      });
      ownerCreated = true;
    }

    if (!existing || changed.length) {
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorType: "SYSTEM",
          action: existing ? "organization.config_synced" : "organization.created",
          entityType: "Organization",
          entityId: org.id,
          after: Object.fromEntries(
            (existing ? changed : Object.keys(settings)).map((k) => [
              k,
              settings[k as keyof typeof settings],
            ]),
          ),
        },
      });
    }
    return { organizationId: org.id, organizationCreated: !existing, ownerCreated, changed };
  });
}

const selectKeys = <T extends object>(o: T) =>
  Object.fromEntries(Object.keys(o).map((k) => [k, true])) as { [K in keyof T]: true };

if (require.main === module) {
  void (async () => {
    const { getClientConfig } = await import("@opsdesk/client-config");
    const prisma = new PrismaClient();
    try {
      const config = getClientConfig();
      const r = await bootstrapOrganization(prisma, config, {
        ownerPassword: process.env.OWNER_INITIAL_PASSWORD,
      });
      console.log(
        `✔ ${config.business.name} (${config.business.slug}) ${r.organizationCreated ? "created" : "in sync"}`,
      );
      if (r.changed.length)
        console.log(`  synced from client config (file + env overrides): ${r.changed.join(", ")}`);
      console.log(
        r.ownerCreated
          ? `  owner created: ${config.owner.email} (password from OWNER_INITIAL_PASSWORD)`
          : "  owner already exists (password untouched)",
      );
    } catch (e) {
      console.error(`✖ bootstrap failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  })();
}
