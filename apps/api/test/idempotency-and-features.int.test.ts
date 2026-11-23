import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPLAY_HEADER } from "../src/common/idempotency.interceptor";
import {
  createCustomer,
  createOrg,
  createService,
  createTestApp,
  type SignedIn,
  type TestContext,
} from "./utils";

describe("Idempotency-Key", () => {
  let ctx: TestContext;
  let owner: SignedIn;
  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await createOrg(ctx.app);
  });
  afterAll(() => ctx.close());

  it("a retried write returns the original response instead of running twice", async () => {
    const c = await createCustomer(owner.agent);
    const s = await createService(owner.agent);
    const key = randomUUID();
    const body = { customerId: c.id, serviceTypeId: s.id };
    const first = await owner.agent.post("/api/jobs").set("Idempotency-Key", key).send(body).expect(201);
    const second = await owner.agent.post("/api/jobs").set("Idempotency-Key", key).send(body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.headers[REPLAY_HEADER.toLowerCase()]).toBe("true");
    expect(await ctx.db.job.count({ where: { customerId: c.id } })).toBe(1);
  });

  it("failed requests aren't stored, so a retry after fixing the problem can succeed", async () => {
    const key = randomUUID();
    await owner.agent
      .post("/api/customers")
      .set("Idempotency-Key", key)
      .send({ name: "", phone: "x" })
      .expect(400);
    await owner.agent
      .post("/api/customers")
      .set("Idempotency-Key", key)
      .send({ name: "Valid", phone: "+234 800 000 0000" })
      .expect(201);
  });

  it("rejects reusing a key for a different request, and malformed keys", async () => {
    const key = randomUUID();
    await owner.agent
      .post("/api/customers")
      .set("Idempotency-Key", key)
      .send({ name: "A", phone: "+234 800 000 0001" })
      .expect(201);
    await owner.agent
      .post("/api/service-types")
      .set("Idempotency-Key", key)
      .send({ name: "S", defaultDurationMinutes: 60, defaultPriceMinor: 1 })
      .expect(400);
    await owner.agent
      .post("/api/customers")
      .set("Idempotency-Key", "bad key!")
      .send({ name: "B", phone: "+234 800 000 0002" })
      .expect(400);
  });

  it("keys are per tenant: another org using the same key gets its own result", async () => {
    const other = await createOrg(ctx.app);
    const key = randomUUID();
    const a = await owner.agent
      .post("/api/customers")
      .set("Idempotency-Key", key)
      .send({ name: "Mine", phone: "+234 800 000 0003" })
      .expect(201);
    const b = await other.agent
      .post("/api/customers")
      .set("Idempotency-Key", key)
      .send({ name: "Theirs", phone: "+234 800 000 0004" })
      .expect(201);
    expect(b.body.id).not.toBe(a.body.id);
    expect(b.body.name).toBe("Theirs");
  });
});

describe("feature toggles", () => {
  let ctx: TestContext;
  let owner: SignedIn;
  beforeAll(async () => {
    ctx = await createTestApp({ features: { inventory: false, technicianApp: false } });
    owner = await createOrg(ctx.app);
  });
  afterAll(() => ctx.close());

  it("disabled modules' endpoints don't exist (404, before and after sign-in)", async () => {
    const jobId = randomUUID();
    const anon = request(ctx.app.getHttpServer());
    for (const path of ["/api/inventory-items", `/api/jobs/${jobId}/parts`, `/api/jobs/${jobId}/media`]) {
      await anon.get(path).expect(404);
      await owner.agent.get(path).expect(404);
    }
    await owner.agent.post(`/api/jobs/${jobId}/uploads`).send({}).expect(404);
  });

  it("core endpoints are unaffected, and /api/config reports the switches", async () => {
    await owner.agent.get("/api/jobs").expect(200);
    const cfg = await request(ctx.app.getHttpServer()).get("/api/config").expect(200);
    expect(cfg.body.features).toMatchObject({ inventory: false, technicianApp: false });
  });
});
