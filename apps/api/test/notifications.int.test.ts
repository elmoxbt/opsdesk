import { randomUUID } from "node:crypto";
import type { CustomerDto, InventoryItemDto, JobDto, NotificationDto, ServiceTypeDto } from "@opsdesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_ATTEMPTS } from "../src/notifications/notification.service";
import {
  createCustomer,
  createJob,
  createOrg,
  createService,
  createTestApp,
  inviteAndAccept,
  type SignedIn,
  type TestContext,
} from "./utils";

let ctx: TestContext;
let owner: SignedIn;
let tech: SignedIn;
let service: ServiceTypeDto;
let slot = 0;

beforeAll(async () => {
  // This business messages customers by email, SMS and WhatsApp.
  ctx = await createTestApp({
    config: (c) => ({ ...c, notifications: { email: true, sms: true, whatsapp: true } }),
  });
  owner = await createOrg(ctx.app);
  tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  service = await createService(owner.agent, { defaultDurationMinutes: 60 });
});
afterAll(() => ctx.close());

async function scheduledJob(customer: CustomerDto): Promise<JobDto> {
  slot += 1;
  return createJob(owner.agent, {
    customerId: customer.id,
    serviceTypeId: service.id,
    technicianId: tech.user.id,
    scheduledStart: new Date(Date.UTC(2035, 0, slot, 9)).toISOString(),
  });
}

const log = async (jobId: string) =>
  (await owner.agent.get("/api/notifications").query({ entityType: "Job", entityId: jobId }).expect(200))
    .body as NotificationDto[];

describe("channels", () => {
  it("sends on every enabled channel the customer can receive, with a short text for SMS/WhatsApp", async () => {
    const withEmail = await createCustomer(owner.agent, {
      email: "amaka@example.com",
      phone: "+234 805 000 0001",
    });
    const job = await scheduledJob(withEmail);
    await ctx.drain();
    expect(ctx.mail.sent.some((m) => m.to === "amaka@example.com" && m.subject.startsWith("Confirmed"))).toBe(
      true,
    );
    const sms = ctx.sms.sent.find((m) => m.to === "+234 805 000 0001");
    expect(sms?.text).toMatch(/confirmed for/);
    expect(sms!.text.length).toBeLessThanOrEqual(320);
    expect(ctx.whatsapp.sent.some((m) => m.to === "+234 805 000 0001")).toBe(true);
    expect((await log(job.id)).map((n) => n.channel).sort()).toEqual(["EMAIL", "SMS", "WHATSAPP"]);

    const phoneOnly = await createCustomer(owner.agent, { phone: "+234 805 000 0002" });
    const job2 = await scheduledJob(phoneOnly);
    await ctx.drain();
    expect((await log(job2.id)).map((n) => n.channel).sort()).toEqual(["SMS", "WHATSAPP"]);
  });
});

describe("delivery", () => {
  it("retries a flaky provider and records the outcome", async () => {
    const c = await createCustomer(owner.agent, { email: "flaky@example.com" });
    ctx.mail.failNext = 2;
    const job = await scheduledJob(c);
    await ctx.drain();
    const email = (await log(job.id)).find((n) => n.channel === "EMAIL")!;
    expect(email).toMatchObject({ status: "SENT", attempts: 3, error: null });
    expect(email.sentAt).not.toBeNull();
  });

  it("gives up after the maximum attempts, keeps the error, and never fails the request that caused it", async () => {
    const c = await createCustomer(owner.agent, { email: "bounce@example.com" });
    ctx.mail.failAlwaysFor = "bounce@example.com";
    const job = await scheduledJob(c); // 201 regardless of the mail outcome
    await ctx.drain();
    ctx.mail.failAlwaysFor = undefined;
    const email = (await log(job.id)).find((n) => n.channel === "EMAIL")!;
    expect(email).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
    expect(email.error).toContain("550");
    // Other channels for the same message were unaffected.
    expect((await log(job.id)).find((n) => n.channel === "SMS")?.status).toBe("SENT");
  });
});

describe("low-stock alerts", () => {
  it("alerts the office once per dip below the reorder level, and again after a restock", async () => {
    const item = (
      await owner.agent
        .post("/api/inventory-items")
        .send({
          name: "Isolation valve",
          sku: `VALVE-${randomUUID().slice(0, 6)}`,
          quantity: 4,
          reorderThreshold: 2,
          unitCostMinor: 900_000,
        })
        .expect(201)
    ).body as InventoryItemDto;
    const c = await createCustomer(owner.agent);
    const job = await scheduledJob(c);
    await tech.agent.post(`/api/jobs/${job.id}/transitions`).send({ to: "EN_ROUTE" }).expect(200);
    await tech.agent.post(`/api/jobs/${job.id}/transitions`).send({ to: "IN_PROGRESS" }).expect(200);
    const use = (quantity: number) =>
      tech.agent
        .post(`/api/jobs/${job.id}/parts`)
        .send({ id: randomUUID(), inventoryItemId: item.id, quantity })
        .expect(201);
    const ownerEmail = (await ctx.db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).email;
    const alerts = async () => {
      await ctx.drain();
      return ctx.mail.sent.filter((m) => m.to === ownerEmail && m.subject === "Low stock: Isolation valve")
        .length;
    };

    await use(1); // 3 left: fine
    expect(await alerts()).toBe(0);
    await use(1); // 2 left: at the threshold
    expect(await alerts()).toBe(1);
    await use(1); // 1 left: still the same dip
    expect(await alerts()).toBe(1);

    // Stocktake restocks it (re-arms), then usage dips again.
    await owner.agent
      .put(`/api/inventory-items/${item.id}`)
      .send({ name: item.name, sku: item.sku, quantity: 3, reorderThreshold: 2, unitCostMinor: 900_000 })
      .expect(200);
    expect(await alerts()).toBe(1);
    await use(1);
    expect(await alerts()).toBe(2);
    // The technician never receives stock alerts.
    const techEmail = (await ctx.db.user.findUniqueOrThrow({ where: { id: tech.user.id } })).email;
    expect(ctx.mail.sent.some((m) => m.to === techEmail && m.subject.startsWith("Low stock"))).toBe(false);
  });
});
