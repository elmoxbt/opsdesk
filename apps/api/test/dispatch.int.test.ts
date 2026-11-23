import type { CustomerDto, DispatchBoardDto, JobDto, ServiceTypeDto } from "@opsdesk/shared";
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
let tech: SignedIn;
let tech2: SignedIn;
let customer: CustomerDto;
let service: ServiceTypeDto;

// Each test uses its own day so tests never collide with each other's bookings.
let dayCounter = 0;
const nextDay = () => {
  dayCounter += 1;
  return (h: number, m = 0) => new Date(Date.UTC(2031, 0, dayCounter, h, m)).toISOString();
};

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await createOrg(ctx.app);
  tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  tech2 = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  customer = await createCustomer(owner.agent, { name: "Dispatch Customer" });
  service = await createService(owner.agent, { defaultDurationMinutes: 60 });
});
afterAll(() => ctx.close());

const requested = () => createJob(owner.agent, { customerId: customer.id, serviceTypeId: service.id });
const booked = (techId: string, start: string, end?: string) =>
  createJob(owner.agent, {
    customerId: customer.id,
    serviceTypeId: service.id,
    technicianId: techId,
    scheduledStart: start,
    ...(end && { scheduledEnd: end }),
  });
const schedule = (job: JobDto, techId: string, start: string, extra: Record<string, unknown> = {}) =>
  owner.agent
    .post(`/api/jobs/${job.id}/schedule`)
    .send({ technicianId: techId, scheduledStart: start, version: job.version, ...extra });

describe("POST /api/jobs/:id/schedule", () => {
  it("schedules a REQUESTED job: assigns, uses the service duration, promotes to SCHEDULED, audits both", async () => {
    const at = nextDay();
    const job = await requested();
    const res = await schedule(job, tech.user.id, at(9)).expect(200);
    expect(res.body).toMatchObject({
      status: "SCHEDULED",
      technician: { id: tech.user.id },
      scheduledStart: at(9),
      scheduledEnd: at(10),
      version: 2,
    });
    const actions = (
      await ctx.db.auditLog.findMany({ where: { entityId: job.id }, orderBy: { createdAt: "asc" } })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["job.rescheduled", "job.status_changed"]));
  });

  it("moving keeps the job's current duration and can reassign the technician", async () => {
    const at = nextDay();
    const job = await booked(tech.user.id, at(9), at(11, 30));
    const res = await schedule(job, tech2.user.id, at(13)).expect(200);
    expect(res.body).toMatchObject({
      technician: { id: tech2.user.id },
      scheduledStart: at(13),
      scheduledEnd: at(15, 30),
    });
  });

  it("returns 409 with the clashing jobs when the slot overlaps", async () => {
    const at = nextDay();
    const blocker = await booked(tech.user.id, at(10), at(11));
    const job = await requested();
    const res = await schedule(job, tech.user.id, at(10, 30)).expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
    expect(res.body.error.message).toMatch(/already booked/);
    expect(res.body.error.conflicts).toEqual([
      expect.objectContaining({ id: blocker.id, number: blocker.number, customerName: "Dispatch Customer" }),
    ]);
  });

  it("allows back-to-back bookings and the same time for a different technician", async () => {
    const at = nextDay();
    await booked(tech.user.id, at(10), at(11));
    await schedule(await requested(), tech.user.id, at(11)).expect(200); // starts exactly when the other ends
    await schedule(await requested(), tech2.user.id, at(10)).expect(200);
  });

  it("completed and cancelled jobs don't block the slot", async () => {
    const at = nextDay();
    const done = await booked(tech.user.id, at(9), at(10));
    for (const to of ["EN_ROUTE", "IN_PROGRESS", "COMPLETED"])
      await owner.agent.post(`/api/jobs/${done.id}/transitions`).send({ to }).expect(200);
    const cancelled = await booked(tech.user.id, at(12), at(13));
    await owner.agent
      .post(`/api/jobs/${cancelled.id}/transitions`)
      .send({ to: "CANCELLED", reason: "x" })
      .expect(200);
    await schedule(await requested(), tech.user.id, at(9)).expect(200);
    await schedule(await requested(), tech.user.id, at(12)).expect(200);
  });

  it("refuses to move a job that's already under way, and needs a real technician", async () => {
    const at = nextDay();
    const job = await booked(tech.user.id, at(9));
    const moving = await owner.agent
      .post(`/api/jobs/${job.id}/transitions`)
      .send({ to: "EN_ROUTE" })
      .expect(200);
    await schedule(moving.body, tech.user.id, at(14)).expect(409);
    const res = await schedule(await requested(), owner.user.id, at(9)).expect(400);
    expect(res.body.error.details).toHaveProperty("technicianId");
  });

  it("rejects a stale version", async () => {
    const at = nextDay();
    const job = await requested();
    await schedule(job, tech.user.id, at(9)).expect(200);
    await schedule(job, tech.user.id, at(14)).expect(409); // still sending version 1
  });

  it("technicians cannot use the board", async () => {
    const job = await requested();
    await tech.agent
      .post(`/api/jobs/${job.id}/schedule`)
      .send({ technicianId: tech.user.id, scheduledStart: nextDay()(9), version: 1 })
      .expect(403);
  });
});

describe("conflicts are enforced on every path, not just the board", () => {
  it("POST /jobs with a technician and a clashing time → 409", async () => {
    const at = nextDay();
    await booked(tech.user.id, at(10), at(12));
    const res = await owner.agent
      .post("/api/jobs")
      .send({
        customerId: customer.id,
        serviceTypeId: service.id,
        technicianId: tech.user.id,
        scheduledStart: at(11),
      })
      .expect(409);
    expect(res.body.error.conflicts).toHaveLength(1);
  });

  it("PUT moving a scheduled job into a clash → 409", async () => {
    const at = nextDay();
    await booked(tech.user.id, at(10), at(11));
    const job = await booked(tech.user.id, at(14), at(15));
    await owner.agent
      .put(`/api/jobs/${job.id}`)
      .send({
        serviceTypeId: service.id,
        technicianId: tech.user.id,
        scheduledStart: at(10, 30),
        scheduledEnd: at(11, 30),
        version: job.version,
      })
      .expect(409);
  });

  it("transition REQUESTED → SCHEDULED into a clash → 409", async () => {
    const at = nextDay();
    await booked(tech.user.id, at(10), at(11));
    const job = await requested();
    const edited = await owner.agent
      .put(`/api/jobs/${job.id}`)
      .send({ serviceTypeId: service.id, technicianId: tech.user.id, scheduledStart: at(10), version: 1 })
      .expect(200); // REQUESTED jobs are tentative: no clash check yet
    await owner.agent
      .post(`/api/jobs/${job.id}/transitions`)
      .send({ to: "SCHEDULED", version: edited.body.version })
      .expect(409);
  });

  it("race: two dispatchers booking the same slot at once, exactly one wins (DB exclusion constraint)", async () => {
    const at = nextDay();
    const [a, b] = await Promise.all([requested(), requested()]);
    const results = await Promise.all([
      schedule(a, tech.user.id, at(9)),
      schedule(b, tech.user.id, at(9, 30)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("the constraint exists in the database itself (bypassing all app code)", async () => {
    const at = nextDay();
    const a = await booked(tech.user.id, at(9), at(10));
    const b = await booked(tech.user.id, at(11), at(12));
    await expect(
      ctx.db.job.update({
        where: { id: b.id },
        data: { scheduledStart: new Date(at(9, 30)), scheduledEnd: new Date(at(10, 30)) },
      }),
    ).rejects.toThrow(/Job_technician_no_overlap|exclusion/i);
    expect(a.id).toBeTruthy();
  });
});

describe("GET /api/jobs/board", () => {
  it("returns technicians, jobs overlapping the range (not just starting in it) and the unscheduled tray", async () => {
    const org = await createOrg(ctx.app);
    const t = await inviteAndAccept(ctx, org.agent, "TECHNICIAN");
    const c = await createCustomer(org.agent);
    const s = await createService(org.agent, { defaultDurationMinutes: 120 });
    const mk = (body: Record<string, unknown>) =>
      createJob(org.agent, { customerId: c.id, serviceTypeId: s.id, ...body });
    const overnight = await mk({ technicianId: t.user.id, scheduledStart: "2031-03-01T23:00:00Z" }); // runs past midnight
    const inside = await mk({ technicianId: t.user.id, scheduledStart: "2031-03-02T10:00:00Z" });
    const outside = await mk({ technicianId: t.user.id, scheduledStart: "2031-03-05T10:00:00Z" });
    const cancelled = await mk({ technicianId: t.user.id, scheduledStart: "2031-03-02T14:00:00Z" });
    await org.agent
      .post(`/api/jobs/${cancelled.id}/transitions`)
      .send({ to: "CANCELLED", reason: "x" })
      .expect(200);
    const tray = await mk({});

    const res = await org.agent
      .get("/api/jobs/board")
      .query({ from: "2031-03-02T00:00:00Z", to: "2031-03-03T00:00:00Z" })
      .expect(200);
    const board = res.body as DispatchBoardDto;
    expect(board.technicians).toEqual([expect.objectContaining({ id: t.user.id })]);
    expect(board.jobs.map((j) => j.id).sort()).toEqual([overnight.id, inside.id].sort());
    expect(board.jobs.map((j) => j.id)).not.toContain(outside.id);
    expect(board.unscheduled.map((j) => j.id)).toEqual([tray.id]);
  });

  it("validates the range and is limited to managers", async () => {
    await owner.agent.get("/api/jobs/board").query({ from: "2031-01-01", to: "2031-03-01" }).expect(400);
    await owner.agent.get("/api/jobs/board").query({ from: "2031-01-02", to: "2031-01-01" }).expect(400);
    await tech.agent.get("/api/jobs/board").query({ from: "2031-01-01", to: "2031-01-02" }).expect(403);
  });
});

describe("dispatch across tenants", () => {
  it("cannot schedule another tenant's job, or onto another tenant's technician", async () => {
    const other = await createOrg(ctx.app);
    const otherTech = await inviteAndAccept(ctx, other.agent, "TECHNICIAN");
    const oc = await createCustomer(other.agent);
    const os = await createService(other.agent);
    const theirs = await createJob(other.agent, { customerId: oc.id, serviceTypeId: os.id });
    await schedule(theirs, tech.user.id, nextDay()(9)).expect(404);
    await schedule(await requested(), otherTech.user.id, nextDay()(9)).expect(400);
    const board = await owner.agent
      .get("/api/jobs/board")
      .query({ from: "2031-01-01", to: "2031-01-14" })
      .expect(200);
    expect((board.body as DispatchBoardDto).technicians.map((t) => t.id)).not.toContain(otherTech.user.id);
  });
});
