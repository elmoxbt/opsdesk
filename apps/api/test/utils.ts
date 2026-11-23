import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { loadClientConfig } from "@opsdesk/client-config";
import type { ClientConfig } from "@opsdesk/config";
import { PrismaClient } from "@opsdesk/db";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "bcryptjs";
import S3rver from "s3rver";
import type { AuthUser, CustomerDto, JobDto, Role, ServiceTypeDto } from "@opsdesk/shared";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import type { MailMessage, MailProvider } from "../src/notifications/mail.provider";
import { MAIL_PROVIDER } from "../src/notifications/mail.provider";
import {
  type MessagingProvider,
  SMS_PROVIDER,
  type TextMessage,
  WHATSAPP_PROVIDER,
} from "../src/notifications/messaging.provider";
import { QueueService } from "../src/queue/queue.service";

/** Captures outgoing email so tests can read invite links instead of mocking internals. */
export class InMemoryMailProvider implements MailProvider {
  readonly sent: MailMessage[] = [];
  /** Failure injection: the next N sends throw (a flaky provider). */
  failNext = 0;
  /** Every send to this address throws (a provider that never recovers). */
  failAlwaysFor?: string;
  async send(message: MailMessage): Promise<void> {
    if (this.failAlwaysFor === message.to) throw new Error("SMTP 550 mailbox unavailable");
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("SMTP 421 try again later");
    }
    this.sent.push(message);
  }
  lastTokenFor(email: string): string {
    const msg = [...this.sent].reverse().find((m) => m.to === email);
    const token = msg?.text.match(/token=([\w-]+)/)?.[1];
    if (!token) throw new Error(`No invite email for ${email}`);
    return decodeURIComponent(token);
  }
}

export class InMemoryMessagingProvider implements MessagingProvider {
  readonly sent: TextMessage[] = [];
  async send(message: TextMessage): Promise<void> {
    this.sent.push(message);
  }
}

export interface TestContext {
  app: INestApplication;
  mail: InMemoryMailProvider;
  sms: InMemoryMessagingProvider;
  whatsapp: InMemoryMessagingProvider;
  /** Waits for queued background work (notifications, PDFs) to finish. */
  drain(): Promise<void>;
  db: PrismaClient;
  close(): Promise<void>;
}

/**
 * Boots the real app for one client config. Tests can flip features to prove
 * that disabled modules really aren't there.
 */
export async function createTestApp(
  opts: {
    features?: Partial<ClientConfig["features"]>;
    s3?: boolean;
    /** Override parts of the client config (e.g. notification channels, booking hours). */
    config?: (c: ClientConfig) => ClientConfig;
  } = {},
): Promise<TestContext> {
  const mail = new InMemoryMailProvider();
  const sms = new InMemoryMessagingProvider();
  const whatsapp = new InMemoryMessagingProvider();
  // A real S3 API (s3rver) for suites that upload: presigned URLs are exercised over HTTP, not mocked.
  let s3: S3rver | undefined;
  if (opts.s3) {
    s3 = new S3rver({
      port: 0,
      address: "127.0.0.1",
      silent: true,
      directory: mkdtempSync(join(tmpdir(), "s3rver-")),
      configureBuckets: [{ name: "opsdesk-test" }],
    });
    const { port } = await s3.run();
    Object.assign(process.env, {
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_PUBLIC_ENDPOINT: "",
      S3_BUCKET: "opsdesk-test",
      S3_ACCESS_KEY: "S3RVER",
      S3_SECRET_KEY: "S3RVER",
    });
  }
  const base = loadClientConfig({});
  const withFeatures: ClientConfig = { ...base, features: { ...base.features, ...opts.features } };
  const clientConfig = opts.config ? opts.config(withFeatures) : withFeatures;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(clientConfig)] })
    .overrideProvider(MAIL_PROVIDER)
    .useValue(mail)
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .overrideProvider(WHATSAPP_PROVIDER)
    .useValue(whatsapp)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: ["error"], rawBody: true }));
  await app.init();
  const db = new PrismaClient();
  return {
    app,
    mail,
    sms,
    whatsapp,
    drain: () => app.get(QueueService).drain(),
    db,
    async close() {
      await db.$disconnect();
      await app.close();
      await s3?.close();
    },
  };
}

let clientSeq = 0;
/**
 * A distinct client IP per simulated person (documentation range 203.0.113.0/24 + 198.18.0.0/15),
 * sent as X-Forwarded-For: tests run "behind a proxy" (TRUST_PROXY_HOPS=1), so per-IP
 * rate limits apply per test user, as they would to real users.
 */
export const nextClientIp = (): string => {
  clientSeq++;
  return `198.18.${Math.floor(clientSeq / 250) % 250}.${(clientSeq % 250) + 1}`;
};

export const unique = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;
export const PASSWORD = "a-very-good-password";

export interface SignedIn {
  agent: TestAgent;
  user: AuthUser;
}

let fixtureDb: PrismaClient | undefined;
let ownerPasswordHash: Promise<string> | undefined;

/**
 * Creates a fresh organization + OWNER directly in the database (production
 * deployments do this via `bootstrap`; there is no signup endpoint), then
 * logs in and returns a cookie-carrying agent. Many orgs per test DB is
 * deliberate: it keeps the tenant-isolation layer under test.
 */
export async function createOrg(app: INestApplication): Promise<SignedIn> {
  fixtureDb ??= new PrismaClient();
  ownerPasswordHash ??= hash(PASSWORD, 4);
  const slug = unique("org");
  await fixtureDb.organization.create({
    data: {
      name: `Org ${slug}`,
      slug,
      users: {
        create: {
          email: `${slug}@test.dev`,
          name: "Owner",
          role: "OWNER",
          passwordHash: await ownerPasswordHash,
        },
      },
    },
  });
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post("/api/auth/login")
    .set("X-Forwarded-For", nextClientIp())
    .send({ email: `${slug}@test.dev`, password: PASSWORD })
    .expect(200);
  return { agent, user: (res.body as { user: AuthUser }).user };
}

/** Invites a user with `role` via `inviter`, accepts it, and returns their signed-in agent. */
export async function inviteAndAccept(
  ctx: TestContext,
  inviter: TestAgent,
  role: Exclude<Role, "OWNER">,
): Promise<SignedIn> {
  const email = `${unique(role.toLowerCase())}@test.dev`;
  await inviter.post("/api/invitations").send({ email, role }).expect(201);
  const agent = request.agent(ctx.app.getHttpServer());
  const res = await agent
    .post("/api/invitations/accept")
    .set("X-Forwarded-For", nextClientIp())
    .send({ token: ctx.mail.lastTokenFor(email), name: role, password: PASSWORD })
    .expect(201);
  return { agent, user: (res.body as { user: AuthUser }).user };
}

export const cookieNames = (res: request.Response): string[] => {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => c.split("=")[0] ?? "");
};

// ---- Phase 2 fixtures --------------------------------------------------------

export async function createCustomer(
  agent: TestAgent,
  overrides: Record<string, unknown> = {},
): Promise<CustomerDto> {
  const res = await agent
    .post("/api/customers")
    .send({ name: unique("Customer"), phone: "+234 801 000 0000", ...overrides })
    .expect(201);
  return res.body as CustomerDto;
}

export async function createService(
  agent: TestAgent,
  overrides: Record<string, unknown> = {},
): Promise<ServiceTypeDto> {
  const res = await agent
    .post("/api/service-types")
    .send({ name: unique("Service"), defaultDurationMinutes: 90, defaultPriceMinor: 1_500_000, ...overrides })
    .expect(201);
  return res.body as ServiceTypeDto;
}

export async function createJob(agent: TestAgent, body: Record<string, unknown>): Promise<JobDto> {
  const res = await agent.post("/api/jobs").send(body).expect(201);
  return res.body as JobDto;
}

/** Logs in fresh and returns the raw access token (for Socket.IO handshakes / Bearer auth). */
export async function accessTokenFor(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/login")
    .set("X-Forwarded-For", nextClientIp())
    .send({ email, password: PASSWORD })
    .expect(200);
  const raw = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("opsdesk_at="));
  if (!raw) throw new Error("no access cookie");
  return decodeURIComponent(raw.split(";")[0]!.slice("opsdesk_at=".length));
}

/** Uploads bytes the way the browser does: PUT to the presigned URL with the signed content type. */
export async function uploadTo(
  ticket: { uploadUrl: string; headers: Record<string, string> },
  bytes: Uint8Array,
): Promise<number> {
  const res = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: bytes });
  return res.status;
}

/** A tiny but real JPEG/PNG header is enough: S3 stores bytes, the API checks type + size. */
export const FAKE_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
]);
export const FAKE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);
