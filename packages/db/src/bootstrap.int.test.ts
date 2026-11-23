/**
 * bootstrap needs a database that serves ONE business, unlike the shared test
 * DB (full of orgs on purpose, for isolation tests). So this suite creates and
 * migrates its own throwaway database.
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { type ClientConfig, defineClientConfig, resolveClientConfig } from "@opsdesk/config";
import { PrismaClient } from "@prisma/client";
import { compare } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BootstrapError, bootstrapOrganization } from "./bootstrap";

const DB_NAME = "opsdesk_bootstrap_test";
const url = new URL(process.env.DATABASE_URL!);
url.pathname = `/${DB_NAME}`;
const admin = new PrismaClient();
let db: PrismaClient;

const config = (patch: { name?: string; slug?: string; primaryColor?: string } = {}): ClientConfig =>
  resolveClientConfig(
    defineClientConfig({
      business: {
        name: patch.name ?? "Acme Plumbing",
        slug: patch.slug ?? "acme-plumbing",
        email: "hi@acme.test",
        timezone: "Africa/Lagos",
        currency: "NGN",
      },
      branding: { primaryColor: patch.primaryColor ?? "#0f766e" },
      features: {
        inventory: true,
        payments: false,
        bookingPortal: true,
        technicianApp: true,
        analytics: false,
        publicApi: false,
      },
      owner: { name: "Ada Owner", email: "owner@acme.test" },
      domains: { app: "app.acme.test" },
    }),
    {},
  );

beforeAll(async () => {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${DB_NAME}`);
  execSync("npx prisma migrate deploy", {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
  });
  db = new PrismaClient({ datasourceUrl: url.toString() });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.$disconnect();
});

describe("bootstrapOrganization", () => {
  it("refuses to create the owner without an initial password", async () => {
    await expect(bootstrapOrganization(db, config(), {})).rejects.toBeInstanceOf(BootstrapError);
    expect(await db.organization.count()).toBe(0); // transaction rolled back
  });

  it("first run: creates the business from config and its owner", async () => {
    const r = await bootstrapOrganization(db, config(), {
      ownerPassword: "first-password-123",
      bcryptRounds: 4,
    });
    expect(r).toMatchObject({ organizationCreated: true, ownerCreated: true, changed: [] });
    const org = await db.organization.findUniqueOrThrow({ where: { id: r.organizationId } });
    expect(org).toMatchObject({
      name: "Acme Plumbing",
      slug: "acme-plumbing",
      brandColor: "#0f766e",
      currency: "NGN",
      timezone: "Africa/Lagos",
    });
    const owner = await db.user.findFirstOrThrow({ where: { organizationId: org.id, role: "OWNER" } });
    expect(owner.email).toBe("owner@acme.test");
    expect(await compare("first-password-123", owner.passwordHash)).toBe(true);
  });

  it("re-run: idempotent, and never touches the owner's password", async () => {
    const r = await bootstrapOrganization(db, config(), {
      ownerPassword: "a-different-password",
      bcryptRounds: 4,
    });
    expect(r).toMatchObject({ organizationCreated: false, ownerCreated: false, changed: [] });
    const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER" } });
    expect(await compare("first-password-123", owner.passwordHash)).toBe(true);
    expect(await db.organization.count()).toBe(1);
  });

  it("syncs settings when client.config.ts changes, and audits what changed", async () => {
    const r = await bootstrapOrganization(
      db,
      config({ name: "Acme Plumbing & Heating", primaryColor: "#1d4ed8" }),
      {},
    );
    expect(r.changed.sort()).toEqual(["brandColor", "name"]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "organization.config_synced" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.after).toEqual({ name: "Acme Plumbing & Heating", brandColor: "#1d4ed8" });
  });

  it("refuses to run against a database that belongs to another business", async () => {
    await expect(
      bootstrapOrganization(db, config({ slug: "someone-else" }), { ownerPassword: "whatever-password" }),
    ).rejects.toThrow(/already belongs to "acme-plumbing"/);
    expect(await db.organization.count()).toBe(1);
  });
});
