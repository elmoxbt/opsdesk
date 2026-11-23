import type { ServiceTypeDto } from "@opsdesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCustomer,
  createJob,
  createService,
  createTestApp,
  inviteAndAccept,
  type SignedIn,
  createOrg,
  type TestContext,
} from "./utils";

let ctx: TestContext;
let owner: SignedIn;
beforeAll(async () => {
  ctx = await createTestApp();
  owner = await createOrg(ctx.app);
});
afterAll(() => ctx.close());

describe("service types", () => {
  it("creates, lists (active only by default) and includes inactive on request", async () => {
    const org = await createOrg(ctx.app);
    const a = await createService(org.agent, { name: "Boiler service" });
    await createService(org.agent, { name: "Old service", isActive: false });
    const active = await org.agent.get("/api/service-types").expect(200);
    expect(active.body.items.map((s: ServiceTypeDto) => s.id)).toEqual([a.id]);
    const all = await org.agent.get("/api/service-types").query({ includeInactive: "true" }).expect(200);
    expect(all.body.total).toBe(2);
  });

  it("rejects duplicate names per org with a field-level 409", async () => {
    await createService(owner.agent, { name: "Leak repair" });
    const res = await owner.agent
      .post("/api/service-types")
      .send({ name: "Leak repair", defaultDurationMinutes: 60, defaultPriceMinor: 100 })
      .expect(409);
    expect(res.body.error.details).toHaveProperty("name");
  });

  it("the same name is fine in a different org", async () => {
    const other = await createOrg(ctx.app);
    await createService(owner.agent, { name: "Deep clean" });
    await createService(other.agent, { name: "Deep clean" });
  });

  it("validates duration and price", async () => {
    const res = await owner.agent
      .post("/api/service-types")
      .send({ name: "X", defaultDurationMinutes: 5, defaultPriceMinor: -1 })
      .expect(400);
    expect(Object.keys(res.body.error.details)).toEqual(
      expect.arrayContaining(["defaultDurationMinutes", "defaultPriceMinor"]),
    );
  });

  it("PUT updates and audits the diff", async () => {
    const s = await createService(owner.agent, { defaultPriceMinor: 100 });
    await owner.agent
      .put(`/api/service-types/${s.id}`)
      .send({ ...s, defaultPriceMinor: 250 })
      .expect(200);
    const audit = await ctx.db.auditLog.findFirst({
      where: { entityId: s.id, action: "service_type.updated" },
    });
    expect(audit).toMatchObject({ before: { defaultPriceMinor: 100 }, after: { defaultPriceMinor: 250 } });
  });

  it("DELETE refuses when jobs use the service, suggesting deactivation", async () => {
    const s = await createService(owner.agent);
    const c = await createCustomer(owner.agent);
    await createJob(owner.agent, { customerId: c.id, serviceTypeId: s.id });
    const res = await owner.agent.delete(`/api/service-types/${s.id}`).expect(409);
    expect(res.body.error.message).toMatch(/deactivate/i);
    const unused = await createService(owner.agent);
    await owner.agent.delete(`/api/service-types/${unused.id}`).expect(204);
  });

  it("everyone can read; only the owner can write", async () => {
    const tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
    const dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
    await tech.agent.get("/api/service-types").expect(200);
    const body = { name: "Nope", defaultDurationMinutes: 60, defaultPriceMinor: 1 };
    await tech.agent.post("/api/service-types").send(body).expect(403);
    await dispatcher.agent.post("/api/service-types").send(body).expect(403);
  });
});
