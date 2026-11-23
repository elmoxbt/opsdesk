import { randomBytes } from "node:crypto";
import type { AnalyticsOverviewDto } from "@opsdesk/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCustomer,
  createOrg,
  createService,
  createTestApp,
  inviteAndAccept,
  type SignedIn,
  type TestContext,
} from "./utils";

/**
 * A hand-built week (Mon 4 – Sun 10 March 2030, Lagos = UTC+1) plus the week
 * before it, so every number below can be checked by hand.
 */
const RANGE = { from: "2030-03-04", to: "2030-03-10" };
const Z = (iso: string) => new Date(iso);

let ctx: TestContext;
let owner: SignedIn;
let techA: SignedIn;
let techB: SignedIn;
let orgId: string;
let report: AnalyticsOverviewDto;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await createOrg(ctx.app);
  techA = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  techB = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  orgId = (await ctx.db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).organizationId;
  const s1 = await createService(owner.agent, {
    name: "Leak repair",
    defaultPriceMinor: 10_000,
    defaultDurationMinutes: 120,
  });
  const s2 = await createService(owner.agent, {
    name: "AC install",
    defaultPriceMinor: 30_000,
    defaultDurationMinutes: 60,
  });
  const customer = await createCustomer(owner.agent);

  let n = 1000;
  const job = (data: Record<string, unknown>) =>
    ctx.db.job.create({
      data: {
        organizationId: orgId,
        number: ++n,
        customerId: customer.id,
        serviceTypeId: s1.id,
        ...data,
      } as never,
    });

  // J1: done Monday 09:00–11:00 Lagos by A, price 10,000. Came from the booking page.
  await job({
    status: "COMPLETED",
    technicianId: techA.user.id,
    scheduledStart: Z("2030-03-04T08:00:00Z"),
    scheduledEnd: Z("2030-03-04T10:00:00Z"),
    completedAt: Z("2030-03-04T10:00:00Z"),
    priceMinor: 10_000,
    source: "BOOKING",
    createdAt: Z("2030-03-04T07:00:00Z"),
  });
  // J2: B, finished at 00:30 Lagos on WEDNESDAY (23:30 UTC Tuesday). No price → service default 30,000.
  const j2 = await job({
    status: "PAID",
    serviceTypeId: s2.id,
    technicianId: techB.user.id,
    scheduledStart: Z("2030-03-05T22:30:00Z"),
    scheduledEnd: Z("2030-03-05T23:30:00Z"),
    completedAt: Z("2030-03-05T23:30:00Z"),
    priceMinor: null,
    createdAt: Z("2030-03-05T07:00:00Z"),
  });
  // J3: previous week, A, 20,000.
  await job({
    status: "COMPLETED",
    technicianId: techA.user.id,
    scheduledStart: Z("2030-02-27T09:00:00Z"),
    scheduledEnd: Z("2030-02-27T10:00:00Z"),
    completedAt: Z("2030-02-27T10:00:00Z"),
    priceMinor: 20_000,
  });
  // J4: cancelled: counts for nothing.
  await job({
    status: "CANCELLED",
    technicianId: techA.user.id,
    scheduledStart: Z("2030-03-06T08:00:00Z"),
    scheduledEnd: Z("2030-03-06T12:00:00Z"),
  });
  // J5: still scheduled (Friday, 4 h for B): booked time, not completed.
  await job({
    status: "SCHEDULED",
    technicianId: techB.user.id,
    scheduledStart: Z("2030-03-08T08:00:00Z"),
    scheduledEnd: Z("2030-03-08T12:00:00Z"),
  });

  const invoice = (data: Record<string, unknown>) =>
    ctx.db.invoice.create({
      data: {
        organizationId: orgId,
        number: `T-${randomBytes(3).toString("hex")}`,
        customerId: customer.id,
        currency: "NGN",
        publicToken: randomBytes(24).toString("base64url"),
        ...data,
      } as never,
    });
  // Issued Tuesday, paid Thursday: 2 days to pay, 30,000 received this week.
  const paid = await invoice({
    jobId: j2.id,
    status: "PAID",
    totalMinor: 30_000,
    amountPaidMinor: 30_000,
    issueDate: Z("2030-03-05T09:00:00Z"),
    sentAt: Z("2030-03-05T09:00:00Z"),
    dueDate: Z("2030-03-19T22:59:59Z"),
    paidAt: Z("2030-03-07T09:00:00Z"),
  });
  await ctx.db.payment.create({
    data: {
      organizationId: orgId,
      invoiceId: paid.id,
      provider: "MANUAL",
      reference: `m-${randomBytes(4).toString("hex")}`,
      idempotencyKey: randomBytes(8).toString("hex"),
      amountMinor: 30_000,
      currency: "NGN",
      status: "SUCCEEDED",
      paidAt: Z("2030-03-07T09:00:00Z"),
    },
  });
  // Previous week's takings: 10,000. Plus a FAILED payment this week that must not count.
  const old = await invoice({
    status: "PARTIALLY_PAID",
    totalMinor: 50_000,
    amountPaidMinor: 10_000,
    issueDate: Z("2030-02-20T09:00:00Z"),
    sentAt: Z("2030-02-20T09:00:00Z"),
    dueDate: new Date(Date.now() - 45 * 86_400_000), // receivables: 31–60 days late
  });
  for (const [status, paidAt] of [
    ["SUCCEEDED", "2030-03-01T09:00:00Z"],
    ["FAILED", "2030-03-06T09:00:00Z"],
  ] as const)
    await ctx.db.payment.create({
      data: {
        organizationId: orgId,
        invoiceId: old.id,
        provider: "MANUAL",
        reference: `m-${randomBytes(4).toString("hex")}`,
        idempotencyKey: randomBytes(8).toString("hex"),
        amountMinor: 10_000,
        currency: "NGN",
        status,
        paidAt: Z(paidAt),
      },
    });
  // Not yet due: current receivables. A draft never counts as invoiced.
  await invoice({
    status: "SENT",
    totalMinor: 7_000,
    sentAt: Z("2030-01-01T00:00:00Z"),
    dueDate: new Date(Date.now() + 5 * 86_400_000),
  });
  await invoice({
    status: "DRAFT",
    totalMinor: 99_000,
    issueDate: Z("2030-03-05T09:00:00Z"),
    dueDate: Z("2030-03-30T00:00:00Z"),
  });

  report = (await owner.agent.get("/api/analytics/overview").query(RANGE).expect(200))
    .body as AnalyticsOverviewDto;
});
afterAll(() => ctx.close());

describe("analytics overview", () => {
  it("computes KPIs against the previous period", () => {
    expect(report.range).toMatchObject({
      previousFrom: "2030-02-25",
      previousTo: "2030-03-03",
      granularity: "day",
    });
    expect(report.kpis.revenueMinor).toEqual({ value: 30_000, previous: 10_000 }); // the FAILED payment is ignored
    // Drafts never count; the old invoice was issued 20 Feb, before the previous week began.
    expect(report.kpis.invoicedMinor).toEqual({ value: 30_000, previous: 0 });
    expect(report.kpis.jobsCompleted).toEqual({ value: 2, previous: 1 });
    expect(report.kpis.avgJobValueMinor).toEqual({ value: 20_000, previous: 20_000 });
    expect(report.kpis.avgDaysToPay.value).toBe(2);
  });

  it("measures utilisation as booked hours over opening hours × technicians", () => {
    // Default hours: Mon–Fri 10 h + Sat 5 h = 55 h per technician; 2 technicians = 110 h.
    // Booked: J1 2 h + J2 1 h + J5 4 h = 7 h (the cancelled job doesn't count).
    expect(report.kpis.utilisation.value).toBeCloseTo(7 / 110, 4);
    const a = report.technicians.find((t) => t.id === techA.user.id)!;
    const b = report.technicians.find((t) => t.id === techB.user.id)!;
    expect(a).toMatchObject({ jobsCompleted: 1, bookedHours: 2, valueMinor: 10_000 });
    expect(a.utilisation).toBeCloseTo(2 / 55, 4);
    expect(b).toMatchObject({ jobsCompleted: 1, bookedHours: 5, valueMinor: 30_000 });
    expect(report.technicians[0]!.id).toBe(techB.user.id); // sorted by value
  });

  it("buckets by day in the business's time zone, with every day present", () => {
    expect(report.series.map((s) => s.bucket)).toEqual([
      "2030-03-04",
      "2030-03-05",
      "2030-03-06",
      "2030-03-07",
      "2030-03-08",
      "2030-03-09",
      "2030-03-10",
    ]);
    const day = (k: string) => report.series.find((s) => s.bucket === k)!;
    expect(day("2030-03-04").jobsCompleted).toBe(1);
    expect(day("2030-03-05").jobsCompleted).toBe(0); // 23:30 UTC Tuesday…
    expect(day("2030-03-06").jobsCompleted).toBe(1); // …is 00:30 Wednesday in Lagos
    expect(day("2030-03-07").revenueMinor).toBe(30_000);
  });

  it("breaks down by service, source and receivables age", () => {
    expect(report.byService.map((s) => [s.name, s.jobs, s.valueMinor])).toEqual([
      ["AC install", 1, 30_000],
      ["Leak repair", 1, 10_000],
    ]);
    expect(report.sources).toEqual({ DASHBOARD: 1, BOOKING: 1, API: 0 });
    expect(report.receivables).toEqual({
      currentMinor: 7_000,
      days1to30Minor: 0,
      days31to60Minor: 40_000,
      days60plusMinor: 0,
    });
  });

  it("switches to weekly and monthly points for longer ranges", async () => {
    const q = await owner.agent
      .get("/api/analytics/overview")
      .query({ from: "2030-01-01", to: "2030-03-31" })
      .expect(200);
    expect(q.body.range.granularity).toBe("week");
    const y = await owner.agent
      .get("/api/analytics/overview")
      .query({ from: "2030-01-01", to: "2030-12-31" })
      .expect(200);
    expect(y.body.range.granularity).toBe("month");
    expect(y.body.series).toHaveLength(12);
    expect(y.body.series[2]).toMatchObject({ bucket: "2030-03-01", jobsCompleted: 2, revenueMinor: 40_000 });
  });

  it("validates the range", async () => {
    await owner.agent
      .get("/api/analytics/overview")
      .query({ from: "2030-03-10", to: "2030-03-01" })
      .expect(400);
    await owner.agent
      .get("/api/analytics/overview")
      .query({ from: "2028-01-01", to: "2030-03-01" })
      .expect(400);
    await owner.agent.get("/api/analytics/overview").query({ from: "yesterday", to: "today" }).expect(400);
  });

  it("is owner-only and tenant-scoped", async () => {
    const dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
    await dispatcher.agent.get("/api/analytics/overview").query(RANGE).expect(403);
    await techA.agent.get("/api/analytics/overview").query(RANGE).expect(403);
    const other = await createOrg(ctx.app);
    const theirs = (await other.agent.get("/api/analytics/overview").query(RANGE).expect(200))
      .body as AnalyticsOverviewDto;
    expect(theirs.kpis.revenueMinor.value).toBe(0);
    expect(theirs.kpis.jobsCompleted.value).toBe(0);
    expect(theirs.technicians).toEqual([]);
  });

  it("doesn't exist when the analytics feature is off", async () => {
    const off = await createTestApp({ features: { analytics: false } });
    try {
      await request(off.app.getHttpServer()).get("/api/analytics/overview").query(RANGE).expect(404);
    } finally {
      await off.close();
    }
  });
});
