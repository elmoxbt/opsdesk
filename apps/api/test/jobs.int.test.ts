import type { CustomerDto, JobDto, ServiceTypeDto } from "@opsdesk/shared";
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
let dispatcher: SignedIn;
let tech: SignedIn;
let tech2: SignedIn;
let customer: CustomerDto;
let service: ServiceTypeDto;

const START = "2030-06-01T09:00:00.000Z";
// Double-booking a technician is now rejected, so every scheduled fixture gets its own day.
let slot = 0;
const nextSlot = () => new Date(Date.UTC(2030, 6, 1 + slot++, 9)).toISOString();

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await createOrg(ctx.app);
  dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
  tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  tech2 = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  customer = await createCustomer(owner.agent, { name: "Funke Akindele" });
  service = await createService(owner.agent, { defaultDurationMinutes: 90, defaultPriceMinor: 2_000_000 });
});
afterAll(() => ctx.close());

const scheduled = (overrides: Record<string, unknown> = {}) =>
  createJob(dispatcher.agent, {
    customerId: customer.id,
    serviceTypeId: service.id,
    technicianId: tech.user.id,
    scheduledStart: nextSlot(),
    ...overrides,
  });

const transition = (who: SignedIn, job: JobDto, to: string, extra: Record<string, unknown> = {}) =>
  who.agent.post(`/api/jobs/${job.id}/transitions`).send({ to, ...extra });

describe("POST /api/jobs", () => {
  it("creates a REQUESTED job when no technician/time is given, with service defaults", async () => {
    const job = await createJob(dispatcher.agent, { customerId: customer.id, serviceTypeId: service.id });
    expect(job).toMatchObject({
      status: "REQUESTED",
      technician: null,
      priceMinor: 2_000_000,
      version: 1,
      checklist: [],
    });
    expect(job.customer.name).toBe("Funke Akindele");
  });

  it("creates a SCHEDULED job when technician + start are given, defaulting end to start + duration", async () => {
    const job = await scheduled();
    expect(job.status).toBe("SCHEDULED");
    expect(Date.parse(job.scheduledEnd!) - Date.parse(job.scheduledStart!)).toBe(90 * 60_000);
    expect(job.technician?.id).toBe(tech.user.id);
  });

  it("numbers jobs sequentially per organization, even under concurrency", async () => {
    const org = await createOrg(ctx.app);
    const c = await createCustomer(org.agent);
    const s = await createService(org.agent);
    const jobs = await Promise.all(
      Array.from({ length: 5 }, () => createJob(org.agent, { customerId: c.id, serviceTypeId: s.id })),
    );
    expect(jobs.map((j) => j.number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects a non-technician as the assignee", async () => {
    const res = await dispatcher.agent
      .post("/api/jobs")
      .send({ customerId: customer.id, serviceTypeId: service.id, technicianId: dispatcher.user.id })
      .expect(400);
    expect(res.body.error.details).toHaveProperty("technicianId");
  });

  it("rejects end before start, and unknown references", async () => {
    await dispatcher.agent
      .post("/api/jobs")
      .send({
        customerId: customer.id,
        serviceTypeId: service.id,
        scheduledStart: START,
        scheduledEnd: "2030-06-01T08:00:00Z",
      })
      .expect(400);
    const res = await dispatcher.agent
      .post("/api/jobs")
      .send({ customerId: "00000000-0000-4000-8000-000000000000", serviceTypeId: service.id })
      .expect(400);
    expect(res.body.error.details).toHaveProperty("customerId");
  });

  it("technicians cannot create jobs", async () => {
    await tech.agent
      .post("/api/jobs")
      .send({ customerId: customer.id, serviceTypeId: service.id })
      .expect(403);
  });
});

describe("GET /api/jobs", () => {
  let org: SignedIn;
  let t: SignedIn;
  let ids: Record<string, string>;

  beforeAll(async () => {
    org = await createOrg(ctx.app);
    t = await inviteAndAccept(ctx, org.agent, "TECHNICIAN");
    const s = await createService(org.agent);
    const alice = await createCustomer(org.agent, { name: "Alice Boiler" });
    const bob = await createCustomer(org.agent, { name: "Bob Generator" });
    const j1 = await createJob(org.agent, { customerId: alice.id, serviceTypeId: s.id });
    const j2 = await createJob(org.agent, {
      customerId: bob.id,
      serviceTypeId: s.id,
      technicianId: t.user.id,
      scheduledStart: "2030-01-10T09:00:00Z",
      notes: "Bring ladder",
    });
    const j3 = await createJob(org.agent, {
      customerId: bob.id,
      serviceTypeId: s.id,
      technicianId: t.user.id,
      scheduledStart: "2030-02-10T09:00:00Z",
    });
    ids = { j1: j1.id, j2: j2.id, j3: j3.id };
  });

  const list = async (query: Record<string, string>, who = org) =>
    ((await who.agent.get("/api/jobs").query(query).expect(200)).body.items as JobDto[]).map((j) => j.id);

  it("filters by status (comma-separated), technician and 'unassigned'", async () => {
    expect(await list({ status: "SCHEDULED" })).toHaveLength(2);
    expect(await list({ status: "REQUESTED,SCHEDULED" })).toHaveLength(3);
    expect(await list({ technicianId: "unassigned" })).toEqual([ids.j1]);
    expect((await list({ technicianId: t.user.id })).sort()).toEqual([ids.j2, ids.j3].sort());
  });

  it("filters by scheduled date range and sorts by schedule", async () => {
    expect(await list({ from: "2030-01-01", to: "2030-02-01" })).toEqual([ids.j2]);
    expect(await list({ status: "SCHEDULED", sort: "scheduledStart" })).toEqual([ids.j2, ids.j3]);
  });

  it("searches customer name, notes and job number", async () => {
    expect(await list({ q: "alice" })).toEqual([ids.j1]);
    expect(await list({ q: "ladder" })).toEqual([ids.j2]);
    expect(await list({ q: "JOB-0003" })).toEqual([ids.j3]);
  });

  it("technicians only ever see their own jobs, whatever they ask for", async () => {
    expect((await list({}, t)).sort()).toEqual([ids.j2, ids.j3].sort());
    expect(await list({ technicianId: "unassigned" }, t)).not.toContain(ids.j1);
    await t.agent.get(`/api/jobs/${ids.j1}`).expect(404);
    await t.agent.get(`/api/jobs/${ids.j2}`).expect(200);
  });

  it("GET /api/jobs/stats returns counts by status in one call", async () => {
    const res = await org.agent.get("/api/jobs/stats").expect(200);
    expect(res.body.byStatus).toMatchObject({ REQUESTED: 1, SCHEDULED: 2, PAID: 0 });
    expect(res.body.unassigned).toBe(1);
    const techStats = await t.agent.get("/api/jobs/stats").expect(200);
    expect(techStats.body.byStatus.REQUESTED).toBe(0);
  });
});

describe("PUT /api/jobs/:id", () => {
  it("updates editable fields, bumps version and audits the diff", async () => {
    const job = await scheduled();
    const res = await dispatcher.agent
      .put(`/api/jobs/${job.id}`)
      .send({
        serviceTypeId: service.id,
        technicianId: tech2.user.id,
        scheduledStart: job.scheduledStart,
        notes: "Customer prefers mornings",
        priceMinor: 2_500_000,
        checklist: [{ id: "a", label: "Check pressure", done: false }],
        version: job.version,
      })
      .expect(200);
    expect(res.body).toMatchObject({ version: 2, priceMinor: 2_500_000, technician: { id: tech2.user.id } });
    const audit = await ctx.db.auditLog.findFirst({ where: { entityId: job.id, action: "job.updated" } });
    expect(audit?.before).toMatchObject({ technicianId: tech.user.id, priceMinor: 2_000_000 });
  });

  it("rejects a stale version with 409 (optimistic concurrency)", async () => {
    const job = await scheduled();
    const body = {
      serviceTypeId: service.id,
      technicianId: tech.user.id,
      scheduledStart: job.scheduledStart,
      version: 1,
    };
    await dispatcher.agent
      .put(`/api/jobs/${job.id}`)
      .send({ ...body, notes: "first" })
      .expect(200);
    const res = await owner.agent
      .put(`/api/jobs/${job.id}`)
      .send({ ...body, notes: "second" })
      .expect(409);
    expect(res.body.error.message).toMatch(/changed by someone else/);
  });

  it("refuses schedule changes once the technician is en route", async () => {
    const job = await scheduled();
    await transition(tech, job, "EN_ROUTE").expect(200);
    await dispatcher.agent
      .put(`/api/jobs/${job.id}`)
      .send({
        serviceTypeId: service.id,
        technicianId: tech2.user.id,
        scheduledStart: job.scheduledStart,
        version: 2,
      })
      .expect(409);
  });

  it("refuses to remove the technician from a scheduled job", async () => {
    const job = await scheduled();
    await dispatcher.agent
      .put(`/api/jobs/${job.id}`)
      .send({ serviceTypeId: service.id, technicianId: null, scheduledStart: job.scheduledStart, version: 1 })
      .expect(400);
  });
});

describe("POST /api/jobs/:id/transitions", () => {
  it("walks the happy path, stamping timestamps and auditing each step", async () => {
    const job = await createJob(dispatcher.agent, { customerId: customer.id, serviceTypeId: service.id });
    await transition(dispatcher, job, "SCHEDULED").expect(400); // no technician/time yet
    await dispatcher.agent
      .put(`/api/jobs/${job.id}`)
      .send({ serviceTypeId: service.id, technicianId: tech.user.id, scheduledStart: START, version: 1 })
      .expect(200);
    await transition(dispatcher, job, "SCHEDULED").expect(200);
    await transition(tech, job, "EN_ROUTE").expect(200);
    const started = await transition(tech, job, "IN_PROGRESS").expect(200);
    expect(started.body.startedAt).toEqual(expect.any(String));
    const done = await transition(tech, job, "COMPLETED").expect(200);
    expect(done.body).toMatchObject({ status: "COMPLETED", completedAt: expect.any(String) });

    const timeline = await owner.agent
      .get("/api/audit-logs")
      .query({ entityType: "Job", entityId: job.id })
      .expect(200);
    const statuses = timeline.body.items
      .filter((a: { action: string }) => a.action === "job.status_changed")
      .map((a: { after: { status: string } }) => a.after.status);
    expect(statuses).toEqual(["COMPLETED", "IN_PROGRESS", "EN_ROUTE", "SCHEDULED"]);
    expect(timeline.body.items[0].actor).toMatchObject({ id: tech.user.id });
  });

  it("rejects invalid transitions with 409", async () => {
    const job = await scheduled();
    const res = await transition(dispatcher, job, "COMPLETED").expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("INVOICED/PAID cannot be set by hand", async () => {
    const job = await scheduled();
    for (const to of ["EN_ROUTE", "IN_PROGRESS", "COMPLETED"]) await transition(tech, job, to).expect(200);
    await transition(owner, job, "INVOICED").expect(403);
  });

  it("cancelling requires a reason and records it", async () => {
    const job = await scheduled();
    await transition(dispatcher, job, "CANCELLED").expect(400);
    const res = await transition(dispatcher, job, "CANCELLED", { reason: "Customer travelling" }).expect(200);
    expect(res.body).toMatchObject({ status: "CANCELLED", cancellationReason: "Customer travelling" });
  });

  it("technicians cannot cancel, and cannot touch other technicians' jobs", async () => {
    const job = await scheduled();
    await transition(tech, job, "CANCELLED", { reason: "x" }).expect(403);
    await transition(tech2, job, "EN_ROUTE").expect(404);
  });

  it("a stale version is rejected", async () => {
    const job = await scheduled();
    await transition(tech, job, "EN_ROUTE", { version: 1 }).expect(200);
    await transition(dispatcher, job, "CANCELLED", { reason: "x", version: 1 }).expect(409);
  });

  it("concurrent transitions: exactly one wins", async () => {
    const job = await scheduled();
    // Same target from two users: whichever commits second either loses the conditional
    // update or sees EN_ROUTE→EN_ROUTE as invalid. Never two successes.
    const results = await Promise.all([
      transition(tech, job, "EN_ROUTE"),
      transition(dispatcher, job, "EN_ROUTE"),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
  });
});

describe("GET /api/audit-logs", () => {
  it("is limited to owners and dispatchers", async () => {
    await tech.agent.get("/api/audit-logs").expect(403);
    await dispatcher.agent.get("/api/audit-logs").expect(200);
  });
});
