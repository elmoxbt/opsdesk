import { randomUUID } from "node:crypto";
import type {
  CheckoutDto,
  CustomerDto,
  InvoiceDto,
  InvoicePaidEvent,
  JobDto,
  PublicInvoiceDto,
  QuoteDto,
  ServiceTypeDto,
} from "@opsdesk/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadClientConfig } from "@opsdesk/client-config";
import { RemindersService } from "../src/billing/reminders.service";
import { FAKE_WEBHOOK_SECRET, FakeGateway } from "../src/payments/fake.gateway";
import { PAYMENT_GATEWAY } from "../src/payments/payment-provider";
import { paystackSignature } from "../src/payments/paystack.gateway";
import { QueueService } from "../src/queue/queue.service";
import { DomainEvents } from "../src/realtime/domain-events";
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
let customer: CustomerDto;
let service: ServiceTypeDto;
let slot = 0;
const paidEvents: InvoicePaidEvent[] = [];

const line = (unitPriceMinor: number, quantity = 1, description = "Labour") => ({
  description,
  quantity,
  unitPriceMinor,
});

beforeAll(async () => {
  ctx = await createTestApp({ s3: true });
  owner = await createOrg(ctx.app);
  customer = await createCustomer(owner.agent, { email: "payer@example.com" });
  service = await createService(owner.agent, { defaultPriceMinor: 3_500_000 });
  ctx.app.get(DomainEvents).stream$.subscribe((e) => {
    if (e.type === "invoice.paid") paidEvents.push(e.event);
  });
});
afterAll(() => ctx.close());

const drain = () => ctx.app.get(QueueService).drain();

async function draft(agent = owner.agent, body: Record<string, unknown> = {}): Promise<InvoiceDto> {
  const res = await agent
    .post("/api/invoices")
    .send({ customerId: customer.id, lineItems: [line(1_000_000)], ...body })
    .expect(201);
  return res.body as InvoiceDto;
}

async function issued(total = 1_000_000): Promise<InvoiceDto> {
  const inv = await draft(owner.agent, { lineItems: [line(total)], taxRateBps: 0 });
  return (await owner.agent.post(`/api/invoices/${inv.id}/issue`).expect(200)).body as InvoiceDto;
}

const tokenOf = (inv: InvoiceDto) => inv.publicUrl!.split("/i/")[1]!;

/** A COMPLETED job with one part used (fixture set up in the DB: completion itself is tested in Phase 4). */
async function completedJob(): Promise<JobDto> {
  slot += 1;
  const job = await createJob(owner.agent, {
    customerId: customer.id,
    serviceTypeId: service.id,
    scheduledStart: new Date(Date.UTC(2034, 0, slot, 9)).toISOString(),
  });
  const { organizationId } = await ctx.db.job.findUniqueOrThrow({ where: { id: job.id } });
  const item = await ctx.db.inventoryItem.create({
    data: {
      organizationId,
      name: "Oil filter",
      sku: `FLT-${randomUUID().slice(0, 6)}`,
      quantity: 10,
      unitCostMinor: 650_000,
    },
  });
  await ctx.db.jobPart.create({
    data: {
      organizationId,
      jobId: job.id,
      inventoryItemId: item.id,
      quantity: 2,
      unitCostMinor: 650_000,
    },
  });
  await ctx.db.job.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  return job;
}

function signedWebhook(
  data: Record<string, unknown>,
  event = "charge.success",
  secret = FAKE_WEBHOOK_SECRET,
) {
  const body = JSON.stringify({
    event,
    data: { id: randomUUID(), status: "success", paid_at: new Date().toISOString(), ...data },
  });
  return { body, signature: paystackSignature(Buffer.from(body), secret) };
}

const postWebhook = (w: { body: string; signature: string }) =>
  request(ctx.app.getHttpServer())
    .post("/api/webhooks/payments")
    .set("content-type", "application/json")
    .set("x-paystack-signature", w.signature)
    .send(w.body);

async function checkout(inv: InvoiceDto): Promise<CheckoutDto> {
  return (
    await request(ctx.app.getHttpServer())
      .post(`/api/public/invoices/${tokenOf(inv)}/checkout`)
      .send({ email: "payer@example.com" })
      .expect(200)
  ).body as CheckoutDto;
}

// ---------------------------------------------------------------------------

describe("drafts", () => {
  it("computes totals server-side (tax on the subtotal) and numbers invoices per organization", async () => {
    const inv = await draft(owner.agent, {
      lineItems: [line(1_500_000, 2), line(450_000, 1, "Pipe")],
      taxRateBps: 750,
    });
    expect(inv).toMatchObject({
      status: "DRAFT",
      subtotalMinor: 3_450_000,
      taxMinor: 258_750,
      totalMinor: 3_708_750,
      balanceMinor: 3_708_750,
      publicUrl: null,
      pdfReady: false,
    });
    expect(inv.number).toMatch(/^INV-\d{4}$/);
    expect(inv.lineItems.map((l) => l.totalMinor)).toEqual([3_000_000, 450_000]);

    const other = await createOrg(ctx.app);
    const c = await createCustomer(other.agent);
    const first = (
      await other.agent
        .post("/api/invoices")
        .send({ customerId: c.id, lineItems: [line(100)] })
        .expect(201)
    ).body as InvoiceDto;
    expect(first.number).toBe("INV-0001");
  });

  it("rejects bad input with field errors", async () => {
    const res = await owner.agent
      .post("/api/invoices")
      .send({ customerId: customer.id, lineItems: [{ description: "", quantity: 0.5, unitPriceMinor: -1 }] })
      .expect(400);
    expect(Object.keys(res.body.error.details)).toEqual(
      expect.arrayContaining([
        "lineItems.0.description",
        "lineItems.0.quantity",
        "lineItems.0.unitPriceMinor",
      ]),
    );
    await owner.agent.post("/api/invoices").send({ customerId: customer.id, lineItems: [] }).expect(400);
    await owner.agent
      .post("/api/invoices")
      .send({ customerId: customer.id, lineItems: [line(1)], dueDate: "2020-01-01" })
      .expect(400);
  });

  it("edits and deletes only drafts", async () => {
    const inv = await draft();
    const edited = (
      await owner.agent
        .put(`/api/invoices/${inv.id}`)
        .send({ customerId: customer.id, lineItems: [line(200, 3)], taxRateBps: 0 })
        .expect(200)
    ).body as InvoiceDto;
    expect(edited.totalMinor).toBe(600);
    await owner.agent.post(`/api/invoices/${inv.id}/issue`).expect(200);
    await owner.agent
      .put(`/api/invoices/${inv.id}`)
      .send({ customerId: customer.id, lineItems: [line(1)] })
      .expect(409);
    await owner.agent.delete(`/api/invoices/${inv.id}`).expect(409);

    const d = await draft();
    await owner.agent.delete(`/api/invoices/${d.id}`).expect(204);
    await owner.agent.get(`/api/invoices/${d.id}`).expect(404);
  });
});

describe("invoice from a completed job", () => {
  it("bills the service and the parts used (cost + configured markup), once", async () => {
    const markup = loadClientConfig({}).invoicing.partsMarkupBps;
    const partPrice = Math.round((650_000 * (10_000 + markup)) / 10_000);
    const job = await completedJob();
    const inv = (await owner.agent.post("/api/invoices/from-job").send({ jobId: job.id }).expect(201))
      .body as InvoiceDto;
    expect(inv.jobId).toBe(job.id);
    expect(inv.lineItems).toEqual([
      expect.objectContaining({
        description: expect.stringContaining(service.name),
        unitPriceMinor: 3_500_000,
      }),
      expect.objectContaining({
        description: expect.stringContaining("Oil filter"),
        quantity: 2,
        unitPriceMinor: partPrice,
        totalMinor: 2 * partPrice,
      }),
    ]);
    await owner.agent.post("/api/invoices/from-job").send({ jobId: job.id }).expect(409);
  });

  it("refuses jobs that aren't completed", async () => {
    const job = await createJob(owner.agent, { customerId: customer.id, serviceTypeId: service.id });
    const res = await owner.agent.post("/api/invoices/from-job").send({ jobId: job.id }).expect(409);
    expect(res.body.error.message).toMatch(/completed/i);
  });
});

describe("issuing", () => {
  it("sends the pay link, moves the job to INVOICED and renders the PDF in the background", async () => {
    const job = await completedJob();
    const d = (await owner.agent.post("/api/invoices/from-job").send({ jobId: job.id }).expect(201))
      .body as InvoiceDto;
    const inv = (await owner.agent.post(`/api/invoices/${d.id}/issue`).expect(200)).body as InvoiceDto;

    expect(inv.status).toBe("SENT");
    expect(inv.publicUrl).toMatch(/\/i\/[\w-]{32}$/);
    expect((await owner.agent.get(`/api/jobs/${job.id}`).expect(200)).body.status).toBe("INVOICED");
    await drain();
    const email = ctx.mail.sent.findLast((m) => m.to === "payer@example.com");
    expect(email?.subject).toContain(inv.number);
    expect(email?.text).toContain(inv.publicUrl);

    await drain();
    const after = (await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body as InvoiceDto;
    expect(after.pdfReady).toBe(true);
    const { url } = (await owner.agent.get(`/api/invoices/${inv.id}/pdf`).expect(200)).body as {
      url: string;
    };
    const pdf = Buffer.from(await (await fetch(url)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    await owner.agent.post(`/api/invoices/${inv.id}/issue`).expect(409);
  });

  it("answers 409 for the PDF while it is still rendering", async () => {
    const d = await draft();
    await owner.agent.get(`/api/invoices/${d.id}/pdf`).expect(409);
  });
});

describe("public invoice page", () => {
  it("shows an issued invoice without internal ids, and 404s drafts and bad tokens alike", async () => {
    const inv = await issued();
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/public/invoices/${tokenOf(inv)}`)
      .expect(200);
    const pub = res.body as PublicInvoiceDto;
    expect(pub).toMatchObject({ number: inv.number, balanceMinor: 1_000_000, canPayOnline: true });
    expect(JSON.stringify(pub)).not.toContain(inv.id);
    expect(JSON.stringify(pub)).not.toContain(customer.id);

    const d = await draft();
    const draftToken = (await ctx.db.invoice.findUniqueOrThrow({ where: { id: d.id } })).publicToken;
    for (const t of [draftToken, "x".repeat(32), "not-a-token"])
      await request(ctx.app.getHttpServer()).get(`/api/public/invoices/${t}`).expect(404);
  });
});

describe("manual payments", () => {
  it("applies partial then full payments, closes the job, and rejects overpayment", async () => {
    const job = await completedJob();
    const d = (await owner.agent.post("/api/invoices/from-job").send({ jobId: job.id }).expect(201))
      .body as InvoiceDto;
    const inv = (await owner.agent.post(`/api/invoices/${d.id}/issue`).expect(200)).body as InvoiceDto;

    const part = (
      await owner.agent
        .post(`/api/invoices/${inv.id}/payments`)
        .send({ amountMinor: 1_000_000, method: "cash" })
        .expect(201)
    ).body as InvoiceDto;
    expect(part).toMatchObject({ status: "PARTIALLY_PAID", amountPaidMinor: 1_000_000 });

    const over = await owner.agent
      .post(`/api/invoices/${inv.id}/payments`)
      .send({ amountMinor: inv.totalMinor, method: "cash" })
      .expect(400);
    expect(over.body.error.details.amountMinor).toBeDefined();

    const full = (
      await owner.agent
        .post(`/api/invoices/${inv.id}/payments`)
        .send({ amountMinor: inv.totalMinor - 1_000_000, method: "bank_transfer", note: "GTB transfer" })
        .expect(201)
    ).body as InvoiceDto;
    expect(full).toMatchObject({ status: "PAID", balanceMinor: 0 });
    expect(full.paidAt).not.toBeNull();
    expect(full.payments).toHaveLength(2);
    expect((await owner.agent.get(`/api/jobs/${job.id}`).expect(200)).body.status).toBe("PAID");
    await owner.agent
      .post(`/api/invoices/${inv.id}/payments`)
      .send({ amountMinor: 1, method: "cash" })
      .expect(409);
  });

  it("records a double-submitted payment once (Idempotency-Key)", async () => {
    const inv = await issued(500_000);
    const key = randomUUID();
    for (let i = 0; i < 2; i++)
      await owner.agent
        .post(`/api/invoices/${inv.id}/payments`)
        .set("Idempotency-Key", key)
        .send({ amountMinor: 100_000, method: "cash" })
        .expect(201);
    const after = (await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body as InvoiceDto;
    expect(after.amountPaidMinor).toBe(100_000);
  });
});

describe("online payment (fake gateway, real webhook pipeline)", () => {
  it("reuses the pending checkout when Pay is pressed twice", async () => {
    const inv = await issued();
    const a = await checkout(inv);
    const b = await checkout(inv);
    expect(b.reference).toBe(a.reference);
    expect(a.authorizationUrl).toContain(`/api/payments/fake/${a.reference}`);
  });

  it("rejects webhooks with a bad or missing signature", async () => {
    const inv = await issued();
    const { reference } = await checkout(inv);
    const w = signedWebhook({ reference, amount: inv.totalMinor, currency: inv.currency });
    await postWebhook({ ...w, signature: paystackSignature(Buffer.from(w.body), "wrong-secret") }).expect(
      401,
    );
    await request(ctx.app.getHttpServer())
      .post("/api/webhooks/payments")
      .set("content-type", "application/json")
      .send(w.body)
      .expect(401);
    // Tampered body, original signature.
    await postWebhook({ body: w.body.replace(String(inv.totalMinor), "1"), signature: w.signature }).expect(
      401,
    );
    expect((await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body.status).toBe("SENT");
  });

  it("applies a charge exactly once under duplicate and concurrent deliveries", async () => {
    const inv = await issued(750_000);
    const { reference } = await checkout(inv);
    const w = signedWebhook({ reference, amount: 750_000, currency: inv.currency });

    const results = await Promise.all([postWebhook(w), postWebhook(w), postWebhook(w)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.map((r) => r.body.result).sort()).toEqual(["duplicate", "duplicate", "processed"]);
    expect((await postWebhook(w).expect(200)).body.result).toBe("duplicate");

    const after = (await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body as InvoiceDto;
    expect(after).toMatchObject({ status: "PAID", amountPaidMinor: 750_000 });
    expect(after.payments.filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
    expect(
      await ctx.db.webhookEvent.count({ where: { externalId: { endsWith: JSON.parse(w.body).data.id } } }),
    ).toBe(1);
  });

  it("ignores a charge whose amount or currency doesn't match what we asked for", async () => {
    const inv = await issued(900_000);
    const { reference } = await checkout(inv);
    await postWebhook(signedWebhook({ reference, amount: 100, currency: inv.currency })).expect(200);
    await postWebhook(signedWebhook({ reference, amount: 900_000, currency: "USD" })).expect(200);
    const after = (await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body as InvoiceDto;
    expect(after).toMatchObject({ status: "SENT", amountPaidMinor: 0 });
  });

  it("acknowledges events for references it doesn't know (other apps on the same account)", async () => {
    const res = await postWebhook(
      signedWebhook({ reference: "someone_else", amount: 1, currency: "NGN" }),
    ).expect(200);
    expect(res.body.result).toBe("ignored");
  });

  it("marks a declined charge FAILED and leaves the invoice open", async () => {
    const inv = await issued();
    const { reference } = await checkout(inv);
    await postWebhook(
      signedWebhook(
        { reference, amount: inv.totalMinor, currency: inv.currency, status: "failed" },
        "charge.failed",
      ),
    ).expect(200);
    const after = (await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body as InvoiceDto;
    expect(after.status).toBe("SENT");
    expect(after.payments[0]?.status).toBe("FAILED");
  });

  it("verifies on return when the webhook hasn't arrived yet, and a late webhook doesn't pay twice", async () => {
    const inv = await issued(300_000);
    const { reference } = await checkout(inv);
    const gateway = ctx.app.get(PAYMENT_GATEWAY) as FakeGateway;
    const lateWebhook = gateway.complete(reference, "success")!; // paid at the gateway, webhook "in flight"

    await request(ctx.app.getHttpServer())
      .post(`/api/public/invoices/${tokenOf(inv)}/verify`)
      .send({ reference })
      .expect(204);
    expect((await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body.status).toBe("PAID");

    await postWebhook({ body: lateWebhook.body.toString(), signature: lateWebhook.signature }).expect(200);
    const after = (await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body as InvoiceDto;
    expect(after.amountPaidMinor).toBe(300_000);
  });

  it("runs the hosted test checkout end to end and redirects back to the invoice", async () => {
    const inv = await issued(120_000);
    const { reference } = await checkout(inv);
    const page = await request(ctx.app.getHttpServer()).get(`/api/payments/fake/${reference}`).expect(200);
    expect(page.text).toContain("TEST MODE");
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/payments/fake/${reference}`)
      .type("form")
      .send({ outcome: "success" })
      .expect(303);
    expect(res.headers.location).toBe(`${inv.publicUrl}?reference=${reference}`);
    const pub = (
      await request(ctx.app.getHttpServer())
        .get(`/api/public/invoices/${tokenOf(inv)}`)
        .expect(200)
    ).body as PublicInvoiceDto;
    expect(pub).toMatchObject({ displayStatus: "PAID", balanceMinor: 0, canPayOnline: false });
    await request(ctx.app.getHttpServer())
      .post(`/api/public/invoices/${tokenOf(inv)}/checkout`)
      .send({ email: "payer@example.com" })
      .expect(409);
  });

  it("flags only an organization's first paid invoice as the first ever", async () => {
    const fresh = await createOrg(ctx.app);
    const c = await createCustomer(fresh.agent);
    const make = async () => {
      const d = (
        await fresh.agent
          .post("/api/invoices")
          .send({ customerId: c.id, lineItems: [line(1000)] })
          .expect(201)
      ).body as InvoiceDto;
      await fresh.agent.post(`/api/invoices/${d.id}/issue`).expect(200);
      await fresh.agent
        .post(`/api/invoices/${d.id}/payments`)
        .send({ amountMinor: d.totalMinor, method: "cash" })
        .expect(201);
      return paidEvents.findLast((e) => e.invoiceId === d.id);
    };
    expect(await make()).toMatchObject({ fullyPaid: true, firstEver: true });
    expect(await make()).toMatchObject({ fullyPaid: true, firstEver: false });
  });
});

describe("overdue reminders", () => {
  it("emails at most once per interval, up to the maximum, and stops when paid", async () => {
    const inv = await issued(400_000);
    await ctx.db.invoice.update({
      where: { id: inv.id },
      data: { dueDate: new Date(Date.now() - 2 * 86_400_000) },
    });
    const reminders = ctx.app.get(RemindersService);
    const count = () => ctx.mail.sent.filter((m) => m.subject.includes(`${inv.number} is overdue`)).length;

    expect((await owner.agent.get(`/api/invoices/${inv.id}`).expect(200)).body.displayStatus).toBe("OVERDUE");
    await reminders.runAll();
    await drain();
    await reminders.runAll(); // same hour again: nothing new
    await drain();
    expect(count()).toBe(1);

    const day = 86_400_000;
    await reminders.runAll(new Date(Date.now() + 3 * day + 1000));
    await drain();
    await reminders.runAll(new Date(Date.now() + 6 * day + 2000));
    await drain();
    await reminders.runAll(new Date(Date.now() + 9 * day + 3000)); // max is 3
    await drain();
    expect(count()).toBe(3);

    const listed = (await owner.agent.get("/api/invoices?status=OVERDUE&pageSize=100").expect(200)).body;
    expect(listed.items.map((i: InvoiceDto) => i.id)).toContain(inv.id);

    const paid = await issued(1000);
    await ctx.db.invoice.update({
      where: { id: paid.id },
      data: { dueDate: new Date(Date.now() - 86_400_000) },
    });
    await owner.agent
      .post(`/api/invoices/${paid.id}/payments`)
      .send({ amountMinor: 1000, method: "cash" })
      .expect(201);
    await reminders.runAll();
    await drain();
    expect(ctx.mail.sent.some((m) => m.subject.includes(`${paid.number} is overdue`))).toBe(false);
  });
});

describe("quotes", () => {
  it("goes DRAFT → SENT → ACCEPTED → converted into a draft invoice with the same lines", async () => {
    const q = (
      await owner.agent
        .post("/api/quotes")
        .send({
          customerId: customer.id,
          lineItems: [line(2_000_000), line(50_000, 4, "Valves")],
          taxRateBps: 750,
        })
        .expect(201)
    ).body as QuoteDto;
    expect(q).toMatchObject({
      status: "DRAFT",
      subtotalMinor: 2_200_000,
      taxMinor: 165_000,
      totalMinor: 2_365_000,
    });
    expect(q.number).toMatch(/^Q-\d{4}$/);

    await owner.agent.post(`/api/quotes/${q.id}/convert`).expect(409); // not accepted yet
    await owner.agent.post(`/api/quotes/${q.id}/status`).send({ status: "ACCEPTED" }).expect(409); // must be sent first
    await owner.agent.post(`/api/quotes/${q.id}/status`).send({ status: "SENT" }).expect(200);
    await owner.agent
      .put(`/api/quotes/${q.id}`)
      .send({ customerId: customer.id, lineItems: [line(1)] })
      .expect(409);
    await owner.agent.post(`/api/quotes/${q.id}/status`).send({ status: "ACCEPTED" }).expect(200);

    const inv = (await owner.agent.post(`/api/quotes/${q.id}/convert`).expect(200)).body as InvoiceDto;
    expect(inv).toMatchObject({ status: "DRAFT", quoteId: q.id, totalMinor: 2_365_000, taxRateBps: 750 });
    expect(inv.lineItems.map((l) => l.description)).toEqual(["Labour", "Valves"]);
    expect((await owner.agent.get(`/api/quotes/${q.id}`).expect(200)).body).toMatchObject({
      status: "CONVERTED",
      invoiceId: inv.id,
    });
    await owner.agent.post(`/api/quotes/${q.id}/convert`).expect(409);
  });

  it("rejects a job that belongs to another customer", async () => {
    const other = await createCustomer(owner.agent);
    const job = await createJob(owner.agent, { customerId: other.id, serviceTypeId: service.id });
    await owner.agent
      .post("/api/quotes")
      .send({ customerId: customer.id, jobId: job.id, lineItems: [line(1)] })
      .expect(400);
  });
});

describe("voiding", () => {
  it("voids unpaid invoices (freeing the job to be re-invoiced) but not ones with payments", async () => {
    const job = await completedJob();
    const d = (await owner.agent.post("/api/invoices/from-job").send({ jobId: job.id }).expect(201))
      .body as InvoiceDto;
    await owner.agent.post(`/api/invoices/${d.id}/issue`).expect(200);
    await owner.agent.post(`/api/invoices/${d.id}/void`).send({ reason: "x" }).expect(400);
    const v = (
      await owner.agent.post(`/api/invoices/${d.id}/void`).send({ reason: "Wrong price" }).expect(200)
    ).body as InvoiceDto;
    expect(v).toMatchObject({ status: "VOID", voidReason: "Wrong price", jobId: null });
    expect((await owner.agent.get(`/api/jobs/${job.id}`).expect(200)).body.status).toBe("COMPLETED");
    await owner.agent.post("/api/invoices/from-job").send({ jobId: job.id }).expect(201);

    const paid = await issued(1000);
    await owner.agent
      .post(`/api/invoices/${paid.id}/payments`)
      .send({ amountMinor: 500, method: "cash" })
      .expect(201);
    await owner.agent.post(`/api/invoices/${paid.id}/void`).send({ reason: "Changed mind" }).expect(409);
  });
});

describe("access control", () => {
  it("keeps billing away from technicians and other organizations", async () => {
    const inv = await issued();
    const tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
    await tech.agent.get("/api/invoices").expect(403);
    await tech.agent.get(`/api/invoices/${inv.id}`).expect(403);
    await tech.agent.get("/api/quotes").expect(403);

    const dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
    await dispatcher.agent.get(`/api/invoices/${inv.id}`).expect(200);
    await dispatcher.agent.post(`/api/invoices/${inv.id}/void`).send({ reason: "Not allowed" }).expect(403);

    const intruder = await createOrg(ctx.app);
    await intruder.agent.get(`/api/invoices/${inv.id}`).expect(404);
    await intruder.agent
      .post(`/api/invoices/${inv.id}/payments`)
      .send({ amountMinor: 1, method: "cash" })
      .expect(404);
    const list = (await intruder.agent.get("/api/invoices").expect(200)).body;
    expect(list.total).toBe(0);
  });

  it("summarises what's owed", async () => {
    const s = (await owner.agent.get("/api/invoices/summary").expect(200)).body;
    expect(s.outstandingMinor).toBeGreaterThan(0);
    expect(s.overdueCount).toBeGreaterThanOrEqual(1);
    expect(s.paidThisMonthMinor).toBeGreaterThan(0);
  });
});

describe("with the payments feature switched off", () => {
  let off: TestContext;
  beforeAll(async () => {
    off = await createTestApp({ features: { payments: false } });
  });
  afterAll(() => off.close());

  it("still invoices, but has no online checkout or webhook endpoint", async () => {
    const o = await createOrg(off.app);
    const c = await createCustomer(o.agent);
    const d = (
      await o.agent
        .post("/api/invoices")
        .send({ customerId: c.id, lineItems: [line(1000)] })
        .expect(201)
    ).body as InvoiceDto;
    const inv = (await o.agent.post(`/api/invoices/${d.id}/issue`).expect(200)).body as InvoiceDto;
    const http = request(off.app.getHttpServer());
    const pub = (await http.get(`/api/public/invoices/${tokenOf(inv)}`).expect(200)).body as PublicInvoiceDto;
    expect(pub.canPayOnline).toBe(false);
    await http
      .post(`/api/public/invoices/${tokenOf(inv)}/checkout`)
      .send({ email: "a@b.co" })
      .expect(404);
    await http.post("/api/webhooks/payments").send({}).expect(404);
  });
});
