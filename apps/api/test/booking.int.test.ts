import type {
  AvailabilityDto,
  BookingConfirmationDto,
  BookingPortalDto,
  BookingStatusDto,
  JobDto,
  ServiceTypeDto,
} from "@opsdesk/shared";
import { zonedDateKey } from "@opsdesk/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOrg,
  createService,
  createTestApp,
  inviteAndAccept,
  type SignedIn,
  type TestContext,
  unique,
} from "./utils";

const TZ = "Africa/Lagos";
let ctx: TestContext;
let owner: SignedIn;
let tech: SignedIn;
let slug: string;
let service: ServiceTypeDto;
let ipSeq = 0;

/**
 * A fresh weekday (Mon–Fri) for each test, a few days out: lead time and closed
 * weekends don't interfere, and no two tests share a day's capacity.
 */
let dayCursor = 2;
function freshDay(): string {
  for (;;) {
    dayCursor++;
    const key = zonedDateKey(new Date(Date.now() + dayCursor * 86_400_000), TZ);
    const dow = new Date(`${key}T12:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) return key;
  }
}

// Each booking from its own client IP (via the trusted proxy header), so the per-IP
// limiter only bites in the test that's about it.
const http = () => request(ctx.app.getHttpServer());
const nextIp = () => `203.0.113.${++ipSeq}`;

function booking(start: string, extra: Record<string, unknown> = {}) {
  return {
    serviceTypeId: service.id,
    start,
    name: "Ngozi Okeke",
    phone: `+234 80${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    email: "ngozi@example.com",
    address: "51 Bode Thomas St, Surulere",
    ...extra,
  };
}

const book = (body: Record<string, unknown>, ip = nextIp()) =>
  http().post(`/api/public/booking/${slug}`).set("X-Forwarded-For", ip).send(body);

async function slots(date: string): Promise<AvailabilityDto["slots"]> {
  const res = await http()
    .get(`/api/public/booking/${slug}/availability`)
    .query({ serviceTypeId: service.id, date })
    .expect(200);
  return (res.body as AvailabilityDto).slots;
}

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await createOrg(ctx.app);
  tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  service = await createService(owner.agent, { defaultDurationMinutes: 60, name: unique("Leak repair") });
  await createService(owner.agent, { name: unique("Retired") }).then((s) =>
    owner.agent.put(`/api/service-types/${s.id}`).send({ ...s, isActive: false }),
  );
  slug = (
    await ctx.db.user.findUniqueOrThrow({ where: { id: owner.user.id }, include: { organization: true } })
  ).organization.slug;
});
afterAll(() => ctx.close());

describe("portal and availability", () => {
  it("lists active services and opening days, and 404s unknown businesses", async () => {
    const portal = (await http().get(`/api/public/booking/${slug}`).expect(200)).body as BookingPortalDto;
    expect(portal.services.map((s) => s.id)).toContain(service.id);
    expect(portal.services.every((s) => !s.name.startsWith("Retired"))).toBe(true);
    expect(portal.openDays).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
    await http().get("/api/public/booking/no-such-business").expect(404);
    await http().get("/api/public/booking/BAD SLUG!").expect(404);
  });

  it("offers hourly slots in opening hours and rejects dates outside the horizon", async () => {
    const s = await slots(freshDay());
    const local = s.map((x) =>
      new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
        new Date(x.start),
      ),
    );
    expect(local[0]).toBe("08:00");
    expect(local.at(-1)).toBe("17:00"); // 60-minute job must end by 18:00
    expect(s.every((x) => x.available)).toBe(true);

    for (const date of ["2020-01-01", zonedDateKey(new Date(Date.now() + 60 * 86_400_000), TZ)])
      await http()
        .get(`/api/public/booking/${slug}/availability`)
        .query({ serviceTypeId: service.id, date })
        .expect(400);
  });
});

describe("booking", () => {
  it("creates an unassigned REQUESTED job at that time, a customer, a status link and both notifications", async () => {
    const [slot] = await slots(freshDay());
    const body = booking(slot!.start, { notes: "Gate code 1234" });
    const res = await book(body).expect(201);
    const conf = res.body as BookingConfirmationDto;
    expect(conf.reference).toMatch(/^JOB-\d{4}$/);

    const jobs = (await owner.agent.get("/api/jobs?status=REQUESTED&pageSize=100").expect(200)).body
      .items as JobDto[];
    const job = jobs.find((j) => j.customer.phone === body.phone)!;
    expect(job).toMatchObject({ source: "BOOKING", technician: null, scheduledStart: slot!.start });
    expect(job.notes).toContain("Gate code 1234");

    const status = (await http().get(`/api/public/bookings/${conf.token}`).expect(200))
      .body as BookingStatusDto;
    expect(status).toMatchObject({
      reference: conf.reference,
      status: "REQUESTED",
      technicianFirstName: null,
    });
    expect(JSON.stringify(status)).not.toContain(job.customer.id);
    await http()
      .get(`/api/public/bookings/${"x".repeat(32)}`)
      .expect(404);

    await ctx.drain();
    const toCustomer = ctx.mail.sent.find(
      (m) => m.to === "ngozi@example.com" && m.subject.includes(conf.reference),
    );
    expect(toCustomer?.text).toContain(`/book/${slug}/b/${conf.token}`);
    const owners = await ctx.db.user.findUniqueOrThrow({ where: { id: owner.user.id } });
    expect(
      ctx.mail.sent.some((m) => m.to === owners.email && m.subject.startsWith("New online booking")),
    ).toBe(true);
  });

  it("recognises a returning customer by phone however it's typed, without overwriting their details", async () => {
    const day = freshDay();
    const [a, b] = await slots(day);
    await book(booking(a!.start, { phone: "+234 803 111 2233", name: "Kunle Ajayi" })).expect(201);
    await book(booking(b!.start, { phone: "0803-111-2233", name: "Someone Else" })).expect(201);
    const { organizationId } = await ctx.db.user.findUniqueOrThrow({ where: { id: owner.user.id } });
    const customers = await ctx.db.customer.findMany({ where: { organizationId, phoneKey: "8031112233" } });
    expect(customers).toHaveLength(1);
    expect(customers[0]!.name).toBe("Kunle Ajayi");
  });

  it("holds capacity: with one technician, a booked slot is no longer offered, and the last slot can't be double-booked", async () => {
    const day = freshDay();
    const [first, second] = await slots(day);
    await book(booking(first!.start)).expect(201);
    const after = await slots(day);
    expect(after.find((s) => s.start === first!.start)?.available).toBe(false);
    expect((await book(booking(first!.start)).expect(409)).body.error.message).toMatch(/just taken/);

    // Two people, the same last slot, at the same moment.
    const results = await Promise.all([book(booking(second!.start)), book(booking(second!.start))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("offers the slot again when another technician joins", async () => {
    const day = freshDay();
    const [slot] = await slots(day);
    await book(booking(slot!.start)).expect(201);
    expect((await slots(day))[0]!.available).toBe(false);
    // A second technician joins: the same slot is bookable again.
    await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
    expect((await slots(day))[0]!.available).toBe(true);
  });

  it("rejects off-grid times, closed days, past times, bad input and bots", async () => {
    const day = freshDay();
    const [slot] = await slots(day);
    const offGrid = new Date(Date.parse(slot!.start) + 15 * 60_000).toISOString();
    expect((await book(booking(offGrid)).expect(400)).body.error.details.start).toBeDefined();
    await book(booking(new Date(Date.now() - 86_400_000).toISOString())).expect(400);
    const res = await book({ ...booking(slot!.start), name: "", phone: "abc", address: "" }).expect(400);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(["name", "phone", "address"]));
    await book({ ...booking(slot!.start), website: "http://spam.example" }).expect(400);
  });

  it("limits bookings per client IP", async () => {
    const day = freshDay();
    const s = await slots(day);
    const ip = nextIp();
    for (let i = 0; i < 5; i++) await book(booking(s[i]!.start), ip).expect(201);
    const res = await book(booking(s[5]!.start), ip).expect(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    await book(booking(s[5]!.start)).expect(201); // another visitor is unaffected
  });
});

describe("customer notifications from the job lifecycle", () => {
  it("confirms when scheduled (again only on a real reschedule), then on the way and done", async () => {
    const day = freshDay();
    const [slot, later] = await slots(day);
    const body = booking(slot!.start, { email: "zainab@example.com", name: "Zainab Bello" });
    const conf = (await book(body).expect(201)).body as BookingConfirmationDto;
    const job = (
      await owner.agent.get("/api/jobs?status=REQUESTED&pageSize=100").expect(200)
    ).body.items.find((j: JobDto) => j.customer.phone === body.phone) as JobDto;
    const mails = () => ctx.mail.sent.filter((m) => m.to === "zainab@example.com").map((m) => m.subject);
    const schedule = async (at: { start: string; end: string }) => {
      const { version } = (await owner.agent.get(`/api/jobs/${job.id}`).expect(200)).body as JobDto;
      await owner.agent
        .post(`/api/jobs/${job.id}/schedule`)
        .send({ technicianId: tech.user.id, scheduledStart: at.start, scheduledEnd: at.end, version })
        .expect(200);
    };

    await schedule(slot!);
    // The same schedule saved again (double drop, retry): no second confirmation.
    await schedule(slot!);
    await ctx.drain();
    expect(mails().filter((s) => s.startsWith("Confirmed"))).toHaveLength(1);

    // A real reschedule: new confirmation.
    await schedule(later!);
    await tech.agent.post(`/api/jobs/${job.id}/transitions`).send({ to: "EN_ROUTE" }).expect(200);
    await ctx.drain();
    expect(mails().filter((s) => s.startsWith("Confirmed"))).toHaveLength(2);
    expect(mails().some((s) => s.includes("is on the way"))).toBe(true);

    const status = (await http().get(`/api/public/bookings/${conf.token}`).expect(200))
      .body as BookingStatusDto;
    expect(status).toMatchObject({ status: "EN_ROUTE", technicianFirstName: expect.any(String) });

    const log = (
      await owner.agent.get("/api/notifications").query({ entityType: "Job", entityId: job.id }).expect(200)
    ).body as Array<{ template: string; status: string }>;
    expect(log.map((n) => n.template)).toEqual(
      expect.arrayContaining(["booking.received", "job.scheduled", "job.en_route"]),
    );
    expect(log.every((n) => n.status === "SENT")).toBe(true);
    await tech.agent.get("/api/notifications").query({ entityType: "Job", entityId: job.id }).expect(403);
  });
});

describe("with the booking portal switched off", () => {
  it("has no public booking endpoints", async () => {
    const off = await createTestApp({ features: { bookingPortal: false } });
    try {
      await request(off.app.getHttpServer()).get(`/api/public/booking/${slug}`).expect(404);
      await request(off.app.getHttpServer()).post(`/api/public/booking/${slug}`).send({}).expect(404);
    } finally {
      await off.close();
    }
  });
});
