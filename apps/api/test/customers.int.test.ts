import type { CustomerDto } from "@opsdesk/shared";
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

describe("customers", () => {
  it("POST creates, normalises empty fields to null and audits", async () => {
    const c = await createCustomer(owner.agent, { name: "Ada Obi", email: "", address: " 12 Allen Ave " });
    expect(c).toMatchObject({ name: "Ada Obi", email: null, address: "12 Allen Ave", notes: null });
    const audit = await ctx.db.auditLog.findFirst({ where: { entityId: c.id } });
    expect(audit).toMatchObject({ action: "customer.created", actorId: owner.user.id });
  });

  it("POST validates with field-level details", async () => {
    const res = await owner.agent.post("/api/customers").send({ name: "", phone: "abc" }).expect(400);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(["name", "phone"]));
  });

  it("GET lists with search, sort and pagination", async () => {
    const org = await createOrg(ctx.app);
    for (const name of ["Zainab Musa", "Bola Ade", "Chika Obi"]) await createCustomer(org.agent, { name });
    await createCustomer(org.agent, { name: "Emeka", phone: "+234 999 555 1234" });

    const page1 = await org.agent.get("/api/customers").query({ pageSize: 2 }).expect(200);
    expect(page1.body.total).toBe(4);
    expect(page1.body.items.map((c: CustomerDto) => c.name)).toEqual(["Bola Ade", "Chika Obi"]);

    const search = await org.agent.get("/api/customers").query({ q: "obi" }).expect(200);
    expect(search.body.items.map((c: CustomerDto) => c.name)).toEqual(["Chika Obi"]);
    const byPhone = await org.agent.get("/api/customers").query({ q: "555" }).expect(200);
    expect(byPhone.body.items.map((c: CustomerDto) => c.name)).toEqual(["Emeka"]);
  });

  it("GET /:id returns the customer with its job count; unknown id is 404", async () => {
    const c = await createCustomer(owner.agent);
    const res = await owner.agent.get(`/api/customers/${c.id}`).expect(200);
    expect(res.body).toMatchObject({ id: c.id, jobCount: 0 });
    await owner.agent.get("/api/customers/00000000-0000-4000-8000-000000000000").expect(404);
  });

  it("PUT replaces fields and audits only what changed", async () => {
    const c = await createCustomer(owner.agent, { name: "Old", phone: "+234 800 000 0001" });
    const res = await owner.agent
      .put(`/api/customers/${c.id}`)
      .send({ name: "New", phone: "+234 800 000 0001", notes: "Gate code 1234" })
      .expect(200);
    expect(res.body).toMatchObject({ name: "New", notes: "Gate code 1234" });
    const audit = await ctx.db.auditLog.findFirst({ where: { entityId: c.id, action: "customer.updated" } });
    expect(audit?.before).toEqual({ name: "Old", notes: null });
    expect(audit?.after).toEqual({ name: "New", notes: "Gate code 1234" });
  });

  it("DELETE removes a customer without jobs, but refuses (409) when jobs exist", async () => {
    const free = await createCustomer(owner.agent);
    await owner.agent.delete(`/api/customers/${free.id}`).expect(204);
    await owner.agent.get(`/api/customers/${free.id}`).expect(404);

    const busy = await createCustomer(owner.agent);
    const svc = await createService(owner.agent);
    await createJob(owner.agent, { customerId: busy.id, serviceTypeId: svc.id });
    const res = await owner.agent.delete(`/api/customers/${busy.id}`).expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("technicians cannot access the customer directory", async () => {
    const tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
    await tech.agent.get("/api/customers").expect(403);
    await tech.agent.post("/api/customers").send({ name: "X", phone: "+234 800 000 0000" }).expect(403);
  });

  it("dispatchers can manage customers", async () => {
    const dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
    await createCustomer(dispatcher.agent);
  });
});
