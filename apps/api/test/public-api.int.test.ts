import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  CreatedApiKeyDto,
  CustomerDto,
  JobDto,
  WebhookDeliveryDto,
  WebhookEndpointWithSecretDto,
  WebhookEnvelope,
} from "@opsdesk/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DISABLE_AFTER_FAILURES, MAX_DELIVERY_ATTEMPTS } from "../src/developer/developer.service";
import {
  createCustomer,
  createOrg,
  createService,
  createTestApp,
  inviteAndAccept,
  PASSWORD,
  type SignedIn,
  type TestContext,
  unique,
} from "./utils";

let ctx: TestContext;
let owner: SignedIn;
const http = () => request(ctx.app.getHttpServer());

/** A real HTTP receiver for webhooks; `fail` makes the next N requests answer 500. */
const received: Array<{ headers: IncomingHttpHeaders; body: string }> = [];
let fail = 0;
let receiver: Server;
let hookUrl: string;

beforeAll(async () => {
  ctx = await createTestApp({ features: { publicApi: true } });
  owner = await createOrg(ctx.app);
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (fail > 0) {
        fail--;
        res.writeHead(500).end("nope");
        return;
      }
      received.push({ headers: req.headers, body });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
});
afterAll(async () => {
  receiver.close();
  await ctx.close();
});

async function key(scopes: string[], o: SignedIn = owner): Promise<CreatedApiKeyDto> {
  return (
    await o.agent
      .post("/api/developer/api-keys")
      .send({ name: unique("Zapier"), scopes })
      .expect(201)
  ).body as CreatedApiKeyDto;
}
const withKey = (k: string) => ({ Authorization: `Bearer ${k}` });

describe("API keys", () => {
  it("are shown once, stored hashed, and listed by prefix only", async () => {
    const k = await key(["customers:read"]);
    expect(k.key).toMatch(/^opsk_[A-Za-z0-9]{12}_[\w-]{32,}$/);
    expect(k.key.startsWith(`opsk_${k.prefix}_`)).toBe(true);
    const list = (await owner.agent.get("/api/developer/api-keys").expect(200)).body as Array<
      Record<string, unknown>
    >;
    expect(JSON.stringify(list)).not.toContain(k.key.split("_")[2]);
    const row = await ctx.db.apiKey.findUniqueOrThrow({ where: { id: k.id } });
    expect(row.keyHash).not.toContain(k.key.split("_")[2]);
  });

  it("can do exactly what their scopes allow, and nothing else", async () => {
    const c = await createCustomer(owner.agent);
    const k = await key(["customers:read"]);
    await http().get(`/api/customers/${c.id}`).set(withKey(k.key)).expect(200);
    const write = await http()
      .post("/api/customers")
      .set(withKey(k.key))
      .send({ name: "X", phone: "+234 801 000 0000" })
      .expect(403);
    expect(write.body.error.message).toContain("customers:write");
    // Routes outside the public API refuse keys whatever their scopes.
    expect((await http().get("/api/users").set(withKey(k.key)).expect(403)).body.error.message).toMatch(
      /isn't available/,
    );
    await http().get("/api/developer/api-keys").set(withKey(k.key)).expect(403); // a key can't mint keys
    await http().get("/api/analytics/overview?from=2026-01-01&to=2026-01-31").set(withKey(k.key)).expect(403);
  });

  it("create jobs marked as API-sourced and audited as the API key", async () => {
    const k = await key(["jobs:write", "jobs:read", "customers:read"]);
    const c = await createCustomer(owner.agent);
    const s = await createService(owner.agent);
    const job = (
      await http()
        .post("/api/jobs")
        .set(withKey(k.key))
        .send({ customerId: c.id, serviceTypeId: s.id })
        .expect(201)
    ).body as JobDto;
    expect(job.source).toBe("API");
    const audit = await ctx.db.auditLog.findFirstOrThrow({
      where: { entityId: job.id, action: "job.created" },
    });
    expect(audit).toMatchObject({ actorType: "API_KEY", actorId: null });
    await http().get(`/api/jobs/${job.id}`).set(withKey(k.key)).expect(200);
  });

  it("reject bad, revoked and expired keys", async () => {
    await http()
      .get("/api/customers")
      .set(withKey("opsk_notarealkey1_" + "x".repeat(40)))
      .expect(401);
    await http().get("/api/customers").set(withKey("opsk_garbage")).expect(401);
    const k = await key(["customers:read"]);
    const tampered = k.key.slice(0, -1) + (k.key.endsWith("A") ? "B" : "A");
    await http().get("/api/customers").set(withKey(tampered)).expect(401);

    await owner.agent.delete(`/api/developer/api-keys/${k.id}`).expect(204);
    expect((await http().get("/api/customers").set(withKey(k.key)).expect(401)).body.error.message).toMatch(
      /revoked/,
    );

    const old = await key(["customers:read"]);
    await ctx.db.apiKey.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await http().get("/api/customers").set(withKey(old.key)).expect(401)).body.error.message).toMatch(
      /expired/,
    );
  });

  it("stay inside their organization", async () => {
    const other = await createOrg(ctx.app);
    const theirs = await createCustomer(other.agent);
    const k = await key(["customers:read"]);
    await http().get(`/api/customers/${theirs.id}`).set(withKey(k.key)).expect(404);
    const list = (await http().get("/api/customers?pageSize=100").set(withKey(k.key)).expect(200)).body
      .items as CustomerDto[];
    expect(list.some((c) => c.id === theirs.id)).toBe(false);
  });

  it("are owner-only to manage", async () => {
    const dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
    await dispatcher.agent
      .post("/api/developer/api-keys")
      .send({ name: "Nope", scopes: ["jobs:read"] })
      .expect(403);
    await dispatcher.agent.get("/api/developer/webhooks").expect(403);
  });

  it("don't work at all when the public API is switched off", async () => {
    const k = await key(["customers:read"]);
    const off = await createTestApp({ features: { publicApi: false } });
    try {
      const res = await request(off.app.getHttpServer())
        .get("/api/customers")
        .set(withKey(k.key))
        .expect(401);
      expect(res.body.error.message).toMatch(/not enabled/);
      await request(off.app.getHttpServer()).get("/api/developer/api-keys").expect(404);
    } finally {
      await off.close();
    }
  });
});

describe("rate limits", () => {
  it("give each API key 120 requests a minute, with RateLimit headers and Retry-After", async () => {
    const k = await key(["customers:read"]);
    const first = await http().get("/api/customers?pageSize=1").set(withKey(k.key)).expect(200);
    expect(first.headers["ratelimit-limit"]).toBe("120");
    expect(first.headers["ratelimit-remaining"]).toBe("119");
    for (let i = 0; i < 119; i++)
      await http().get("/api/customers?pageSize=1").set(withKey(k.key)).expect(200);
    const limited = await http().get("/api/customers?pageSize=1").set(withKey(k.key)).expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // Another key has its own budget; people in the dashboard aren't affected.
    const k2 = await key(["customers:read"]);
    await http().get("/api/customers?pageSize=1").set(withKey(k2.key)).expect(200);
    await owner.agent.get("/api/customers?pageSize=1").expect(200);
  });

  it("brake password guessing on login", async () => {
    const email = `${unique("nobody")}@test.dev`;
    const attempts = [];
    for (let i = 0; i < 11; i++)
      attempts.push(
        (
          await http()
            .post("/api/auth/login")
            .set("X-Forwarded-For", "198.51.100.7")
            .send({ email, password: PASSWORD })
        ).status,
      );
    // 10 attempts in the window answer normally (401), the 11th is refused before checking anything.
    expect(attempts.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(attempts[10]).toBe(429);
  });
});

describe("outgoing webhooks", () => {
  let endpoint: WebhookEndpointWithSecretDto;
  beforeEach(() => {
    received.length = 0;
    fail = 0;
  });

  beforeAll(async () => {
    endpoint = (
      await owner.agent
        .post("/api/developer/webhooks")
        .send({ url: hookUrl, events: ["job.created", "job.status_changed"], description: "CRM sync" })
        .expect(201)
    ).body as WebhookEndpointWithSecretDto;
  });

  it("stores the signing secret encrypted and shows it only once", async () => {
    expect(endpoint.secret).toMatch(/^whsec_/);
    const row = await ctx.db.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(row.secret).toMatch(/^v1:/);
    expect(row.secret).not.toContain(endpoint.secret);
    const list = (await owner.agent.get("/api/developer/webhooks").expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(endpoint.secret);
  });

  it("delivers subscribed events, signed so the receiver can verify them", async () => {
    const c = await createCustomer(owner.agent);
    const s = await createService(owner.agent);
    const job = (
      await owner.agent.post("/api/jobs").send({ customerId: c.id, serviceTypeId: s.id }).expect(201)
    ).body as JobDto;
    await ctx.drain();

    const hit = received.find((r) => (JSON.parse(r.body) as WebhookEnvelope<JobDto>).data.id === job.id)!;
    expect(hit).toBeDefined();
    const env = JSON.parse(hit.body) as WebhookEnvelope<JobDto>;
    expect(env).toMatchObject({ type: "job.created", data: { id: job.id, number: job.number } });
    expect(hit.headers["opsdesk-event-id"]).toBe(env.id);
    expect(hit.headers["opsdesk-event-type"]).toBe("job.created");
    // Verify exactly as a receiver would: HMAC-SHA256 over "<t>.<raw body>".
    const [, t, v1] = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(String(hit.headers["opsdesk-signature"]))!;
    expect(createHmac("sha256", endpoint.secret).update(`${t}.${hit.body}`).digest("hex")).toBe(v1);
    expect(Math.abs(Date.now() / 1000 - Number(t))).toBeLessThan(60);
  });

  it("only sends the events an endpoint subscribed to", async () => {
    const other = (
      await owner.agent
        .post("/api/developer/webhooks")
        .send({ url: `${hookUrl}?only=paid`, events: ["invoice.paid"] })
        .expect(201)
    ).body as WebhookEndpointWithSecretDto;
    const c = await createCustomer(owner.agent);
    const s = await createService(owner.agent);
    await owner.agent.post("/api/jobs").send({ customerId: c.id, serviceTypeId: s.id }).expect(201);
    await ctx.drain();
    expect(await ctx.db.webhookDelivery.count({ where: { endpointId: other.id } })).toBe(0);
    await owner.agent.delete(`/api/developer/webhooks/${other.id}`).expect(204);
  });

  it("retries a failing receiver with backoff, then records success", async () => {
    fail = 2;
    const c = await createCustomer(owner.agent);
    const s = await createService(owner.agent);
    const job = (
      await owner.agent.post("/api/jobs").send({ customerId: c.id, serviceTypeId: s.id }).expect(201)
    ).body as JobDto;
    await ctx.drain();
    const deliveries = (
      await owner.agent.get(`/api/developer/webhooks/${endpoint.id}/deliveries`).expect(200)
    ).body as WebhookDeliveryDto[];
    const d = deliveries.find((x) => (x.payload as WebhookEnvelope<JobDto>).data.id === job.id)!;
    expect(d).toMatchObject({ status: "SUCCEEDED", attempts: 3, responseStatus: 200 });
  });

  it("gives up after the maximum attempts, counts the failure, and switches a hopeless endpoint off", async () => {
    await ctx.db.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { failureCount: DISABLE_AFTER_FAILURES - 1 },
    });
    fail = MAX_DELIVERY_ATTEMPTS;
    const c = await createCustomer(owner.agent);
    const s = await createService(owner.agent);
    const job = (
      await owner.agent.post("/api/jobs").send({ customerId: c.id, serviceTypeId: s.id }).expect(201)
    ).body as JobDto;
    await ctx.drain();
    const d = (
      (await owner.agent.get(`/api/developer/webhooks/${endpoint.id}/deliveries`).expect(200))
        .body as WebhookDeliveryDto[]
    ).find((x) => (x.payload as WebhookEnvelope<JobDto>).data.id === job.id)!;
    expect(d).toMatchObject({ status: "FAILED", attempts: MAX_DELIVERY_ATTEMPTS, responseStatus: 500 });
    const e = await ctx.db.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(e).toMatchObject({ isActive: false, failureCount: DISABLE_AFTER_FAILURES });
    expect(e.disabledReason).toMatch(/failed deliveries/);

    // Re-enabling clears the counter; redelivering the failed one now succeeds, same event id.
    await owner.agent
      .put(`/api/developer/webhooks/${endpoint.id}`)
      .send({ url: hookUrl, events: ["job.created", "job.status_changed"], isActive: true })
      .expect(200);
    await owner.agent.post(`/api/developer/webhooks/${endpoint.id}/deliveries/${d.id}/redeliver`).expect(202);
    await ctx.drain();
    const again = await ctx.db.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(again.status).toBe("SUCCEEDED");
    expect(received.at(-1)?.headers["opsdesk-event-id"]).toBe(d.eventId);
    expect(
      (await ctx.db.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).failureCount,
    ).toBe(0);
  });

  it("sends a signed test ping on demand and rotates the secret", async () => {
    const ping = (await owner.agent.post(`/api/developer/webhooks/${endpoint.id}/test`).expect(200))
      .body as WebhookDeliveryDto;
    expect(ping).toMatchObject({ eventType: "ping", status: "SUCCEEDED", attempts: 1 });
    const rotated = (
      await owner.agent.post(`/api/developer/webhooks/${endpoint.id}/rotate-secret`).expect(200)
    ).body as WebhookEndpointWithSecretDto;
    expect(rotated.secret).not.toBe(endpoint.secret);
    await owner.agent.post(`/api/developer/webhooks/${endpoint.id}/test`).expect(200);
    const last = received.at(-1)!;
    const [, t, v1] = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(String(last.headers["opsdesk-signature"]))!;
    expect(createHmac("sha256", rotated.secret).update(`${t}.${last.body}`).digest("hex")).toBe(v1);
  });

  it("validates endpoints", async () => {
    await owner.agent
      .post("/api/developer/webhooks")
      .send({ url: "not a url", events: ["job.created"] })
      .expect(400);
    await owner.agent.post("/api/developer/webhooks").send({ url: hookUrl, events: [] }).expect(400);
    await owner.agent
      .post("/api/developer/webhooks")
      .send({ url: hookUrl, events: ["job.exploded"] })
      .expect(400);
  });
});
