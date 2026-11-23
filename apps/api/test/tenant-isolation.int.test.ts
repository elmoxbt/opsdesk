/**
 * Attack-style tests: a fully authenticated user in tenant A tries to read or
 * modify tenant B's data by guessing/obtaining B's ids. Every attempt must fail
 * as "not found", which is indistinguishable from the id not existing at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, inviteAndAccept, type SignedIn, createOrg, type TestContext, unique } from "./utils";

let ctx: TestContext;
let a: SignedIn;
let b: SignedIn;
let bTech: SignedIn;
let bInvitationId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  a = await createOrg(ctx.app);
  b = await createOrg(ctx.app);
  bTech = await inviteAndAccept(ctx, b.agent, "TECHNICIAN");
  const inv = await b.agent
    .post("/api/invitations")
    .send({ email: `${unique("p")}@test.dev`, role: "DISPATCHER" })
    .expect(201);
  bInvitationId = inv.body.id;
});
afterAll(() => ctx.close());

describe("cross-tenant isolation over HTTP", () => {
  it("listing users only ever returns the caller's tenant", async () => {
    const res = await a.agent.get("/api/users").expect(200);
    const orgIds = new Set<string>();
    for (const u of res.body.items as Array<{ id: string }>) {
      const row = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
      orgIds.add(row.organizationId);
    }
    expect([...orgIds]).toEqual([a.user.organization.id]);
    expect(res.body.items.map((u: { id: string }) => u.id)).not.toContain(bTech.user.id);
  });

  it("cannot change the role of another tenant's user", async () => {
    await a.agent.patch(`/api/users/${bTech.user.id}/role`).send({ role: "DISPATCHER" }).expect(404);
    const row = await ctx.db.user.findUniqueOrThrow({ where: { id: bTech.user.id } });
    expect(row.role).toBe("TECHNICIAN");
  });

  it("cannot deactivate another tenant's user", async () => {
    await a.agent.post(`/api/users/${bTech.user.id}/deactivate`).expect(404);
    expect((await ctx.db.user.findUniqueOrThrow({ where: { id: bTech.user.id } })).isActive).toBe(true);
    await bTech.agent.get("/api/auth/me").expect(200);
  });

  it("cannot see or revoke another tenant's invitations", async () => {
    const list = await a.agent.get("/api/invitations").expect(200);
    expect(list.body.map((i: { id: string }) => i.id)).not.toContain(bInvitationId);
    await a.agent.delete(`/api/invitations/${bInvitationId}`).expect(404);
    expect(
      (await ctx.db.invitation.findUniqueOrThrow({ where: { id: bInvitationId } })).revokedAt,
    ).toBeNull();
  });

  it("audit entries are written to the actor's tenant only", async () => {
    await a.agent
      .post("/api/invitations")
      .send({ email: `${unique("x")}@test.dev`, role: "TECHNICIAN" })
      .expect(201);
    const leaked = await ctx.db.auditLog.count({
      where: { organizationId: b.user.organization.id, actorId: a.user.id },
    });
    expect(leaked).toBe(0);
  });
});

describe("cross-tenant isolation: customers, services, jobs (Phase 2)", () => {
  let bCustomer: string;
  let bService: string;
  let bJob: string;
  let aCustomer: string;
  let aService: string;

  beforeAll(async () => {
    const c = await b.agent
      .post("/api/customers")
      .send({ name: "B customer", phone: "+234 800 000 0002" })
      .expect(201);
    const s = await b.agent
      .post("/api/service-types")
      .send({ name: "B service", defaultDurationMinutes: 60, defaultPriceMinor: 100 })
      .expect(201);
    const j = await b.agent
      .post("/api/jobs")
      .send({ customerId: c.body.id, serviceTypeId: s.body.id })
      .expect(201);
    [bCustomer, bService, bJob] = [c.body.id, s.body.id, j.body.id];
    aCustomer = (
      await a.agent
        .post("/api/customers")
        .send({ name: "A customer", phone: "+234 800 000 0003" })
        .expect(201)
    ).body.id;
    aService = (
      await a.agent
        .post("/api/service-types")
        .send({ name: "A service", defaultDurationMinutes: 60, defaultPriceMinor: 100 })
        .expect(201)
    ).body.id;
  });

  it("cannot read B's customer, service or job by id", async () => {
    await a.agent.get(`/api/customers/${bCustomer}`).expect(404);
    await a.agent.get(`/api/jobs/${bJob}`).expect(404);
    const services = await a.agent.get("/api/service-types").query({ includeInactive: "true" }).expect(200);
    expect(services.body.items.map((s: { id: string }) => s.id)).not.toContain(bService);
  });

  it("lists never include B's rows", async () => {
    const customers = await a.agent.get("/api/customers").query({ pageSize: 100 }).expect(200);
    expect(customers.body.items.map((c: { id: string }) => c.id)).not.toContain(bCustomer);
    const jobs = await a.agent.get("/api/jobs").query({ pageSize: 100 }).expect(200);
    expect(jobs.body.items.map((j: { id: string }) => j.id)).not.toContain(bJob);
    const audit = await a.agent.get("/api/audit-logs").query({ entityId: bJob }).expect(200);
    expect(audit.body.total).toBe(0);
  });

  it("cannot modify or delete B's customer or service", async () => {
    await a.agent
      .put(`/api/customers/${bCustomer}`)
      .send({ name: "pwned", phone: "+234 800 000 0000" })
      .expect(404);
    await a.agent.delete(`/api/customers/${bCustomer}`).expect(404);
    await a.agent
      .put(`/api/service-types/${bService}`)
      .send({ name: "pwned", defaultDurationMinutes: 60, defaultPriceMinor: 1 })
      .expect(404);
    await a.agent.delete(`/api/service-types/${bService}`).expect(404);
    expect((await ctx.db.customer.findUniqueOrThrow({ where: { id: bCustomer } })).name).toBe("B customer");
  });

  it("cannot update or transition B's job", async () => {
    await a.agent.put(`/api/jobs/${bJob}`).send({ serviceTypeId: aService, version: 1 }).expect(404);
    await a.agent.post(`/api/jobs/${bJob}/transitions`).send({ to: "CANCELLED", reason: "x" }).expect(404);
    expect((await ctx.db.job.findUniqueOrThrow({ where: { id: bJob } })).status).toBe("REQUESTED");
  });

  it("cannot create a job that references B's customer, service or technician", async () => {
    await a.agent.post("/api/jobs").send({ customerId: bCustomer, serviceTypeId: aService }).expect(400);
    await a.agent.post("/api/jobs").send({ customerId: aCustomer, serviceTypeId: bService }).expect(400);
    const res = await a.agent
      .post("/api/jobs")
      .send({
        customerId: aCustomer,
        serviceTypeId: aService,
        technicianId: bTech.user.id,
        scheduledStart: "2030-01-01T09:00:00Z",
      })
      .expect(400);
    expect(res.body.error.details).toHaveProperty("technicianId");
    expect(
      await ctx.db.job.count({ where: { organizationId: a.user.organization.id, customerId: bCustomer } }),
    ).toBe(0);
  });
});
