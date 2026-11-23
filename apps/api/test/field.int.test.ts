import { randomUUID } from "node:crypto";
import type { CustomerDto, JobDto, JobMediaDto, ServiceTypeDto, UploadTicketDto } from "@opsdesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCustomer,
  createJob,
  createOrg,
  createService,
  createTestApp,
  FAKE_JPEG,
  FAKE_PNG,
  inviteAndAccept,
  type SignedIn,
  type TestContext,
  uploadTo,
} from "./utils";

let ctx: TestContext;
let owner: SignedIn;
let tech: SignedIn;
let otherTech: SignedIn;
let customer: CustomerDto;
let service: ServiceTypeDto;
let slot = 0;

beforeAll(async () => {
  ctx = await createTestApp({ s3: true });
  owner = await createOrg(ctx.app);
  tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  otherTech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  customer = await createCustomer(owner.agent);
  service = await createService(owner.agent, { defaultDurationMinutes: 60 });
});
afterAll(() => ctx.close());

/** A job assigned to `tech`, already IN_PROGRESS (what a technician on site sees). */
async function jobInProgress(extra: Record<string, unknown> = {}): Promise<JobDto> {
  slot += 1;
  const job = await createJob(owner.agent, {
    customerId: customer.id,
    serviceTypeId: service.id,
    technicianId: tech.user.id,
    scheduledStart: new Date(Date.UTC(2033, 0, slot, 9)).toISOString(),
    ...extra,
  });
  await tech.agent.post(`/api/jobs/${job.id}/transitions`).send({ to: "EN_ROUTE" }).expect(200);
  return (await tech.agent.post(`/api/jobs/${job.id}/transitions`).send({ to: "IN_PROGRESS" }).expect(200))
    .body as JobDto;
}

async function upload(
  job: JobDto,
  kind: "BEFORE" | "AFTER" | "SIGNATURE",
  bytes = FAKE_JPEG,
  contentType = "image/jpeg",
) {
  const ticket = (
    await tech.agent
      .post(`/api/jobs/${job.id}/uploads`)
      .send({ kind, contentType, sizeBytes: bytes.length })
      .expect(201)
  ).body as UploadTicketDto;
  expect(await uploadTo(ticket, bytes)).toBe(200);
  return ticket;
}

describe("photos: presigned upload → confirm → presigned download", () => {
  it("records a photo only after verifying the object in S3", async () => {
    const job = await jobInProgress();
    const ticket = await upload(job, "BEFORE");
    expect(ticket.key).toMatch(
      new RegExp(`^org/${owner.user.organization.id}/jobs/${job.id}/before/[0-9a-f-]+\\.jpg$`),
    );

    const res = await tech.agent
      .post(`/api/jobs/${job.id}/photos`)
      .send({ key: ticket.key, kind: "BEFORE" })
      .expect(201);
    const media = res.body as JobMediaDto;
    expect(media.photos).toHaveLength(1);
    expect(media.photos[0]).toMatchObject({
      kind: "BEFORE",
      contentType: "image/jpeg",
      uploadedBy: { id: tech.user.id },
    });

    // The bucket is private; the presigned GET URL is the only way in.
    const download = await fetch(media.photos[0]!.url);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(FAKE_JPEG);
  });

  it("confirming the same upload twice (offline replay) records it once", async () => {
    const job = await jobInProgress();
    const ticket = await upload(job, "AFTER");
    await tech.agent.post(`/api/jobs/${job.id}/photos`).send({ key: ticket.key, kind: "AFTER" }).expect(201);
    const again = await tech.agent
      .post(`/api/jobs/${job.id}/photos`)
      .send({ key: ticket.key, kind: "AFTER" })
      .expect(201);
    expect((again.body as JobMediaDto).photos).toHaveLength(1);
  });

  it("rejects confirms for objects that don't exist, or belong to another job or kind", async () => {
    const job = await jobInProgress();
    const other = await jobInProgress();
    const ticket = await upload(other, "BEFORE");
    await tech.agent.post(`/api/jobs/${job.id}/photos`).send({ key: ticket.key, kind: "BEFORE" }).expect(400); // other job's key
    await tech.agent
      .post(`/api/jobs/${other.id}/photos`)
      .send({ key: ticket.key, kind: "AFTER" })
      .expect(400); // wrong kind prefix
    const missing = `org/${owner.user.organization.id}/jobs/${job.id}/before/${randomUUID()}.jpg`;
    const res = await tech.agent
      .post(`/api/jobs/${job.id}/photos`)
      .send({ key: missing, kind: "BEFORE" })
      .expect(400);
    expect(res.body.error.message).toMatch(/not found/i);
  });

  it("validates the upload request (type, size)", async () => {
    const job = await jobInProgress();
    await tech.agent
      .post(`/api/jobs/${job.id}/uploads`)
      .send({ kind: "BEFORE", contentType: "application/pdf", sizeBytes: 10 })
      .expect(400);
    await tech.agent
      .post(`/api/jobs/${job.id}/uploads`)
      .send({ kind: "BEFORE", contentType: "image/jpeg", sizeBytes: 11 * 1024 * 1024 })
      .expect(400);
  });

  it("other technicians can't upload to, or see media of, someone else's job", async () => {
    const job = await jobInProgress();
    await otherTech.agent
      .post(`/api/jobs/${job.id}/uploads`)
      .send({ kind: "BEFORE", contentType: "image/jpeg", sizeBytes: 10 })
      .expect(404);
    await otherTech.agent.get(`/api/jobs/${job.id}/media`).expect(404);
    await owner.agent.get(`/api/jobs/${job.id}/media`).expect(200); // managers can
  });

  it("a technician can remove their own photo before completion", async () => {
    const job = await jobInProgress();
    const ticket = await upload(job, "BEFORE");
    const media = (
      await tech.agent.post(`/api/jobs/${job.id}/photos`).send({ key: ticket.key, kind: "BEFORE" })
    ).body as JobMediaDto;
    await tech.agent.delete(`/api/jobs/${job.id}/photos/${media.photos[0]!.id}`).expect(204);
    expect(((await tech.agent.get(`/api/jobs/${job.id}/media`)).body as JobMediaDto).photos).toEqual([]);
  });
});

describe("completion with signature", () => {
  it("IN_PROGRESS → COMPLETED with the signature, atomically; replay is a no-op", async () => {
    const job = await jobInProgress();
    const sig = await upload(job, "SIGNATURE", FAKE_PNG, "image/png");
    const body = { signatureKey: sig.key, signedByName: "Funke Adeyemi", version: job.version };
    const done = await tech.agent.post(`/api/jobs/${job.id}/complete`).send(body).expect(200);
    expect(done.body).toMatchObject({ status: "COMPLETED", completedAt: expect.any(String) });
    const replay = await tech.agent.post(`/api/jobs/${job.id}/complete`).send(body).expect(200);
    expect(replay.body.version).toBe(done.body.version);

    const media = (await owner.agent.get(`/api/jobs/${job.id}/media`).expect(200)).body as JobMediaDto;
    expect(media.signature).toMatchObject({
      signedByName: "Funke Adeyemi",
      url: expect.stringContaining("signature"),
    });
  });

  it("refuses a stale version, a job not in progress, or a signature that isn't uploaded", async () => {
    const job = await jobInProgress();
    const sig = await upload(job, "SIGNATURE", FAKE_PNG, "image/png");
    await tech.agent
      .post(`/api/jobs/${job.id}/complete`)
      .send({ signatureKey: sig.key, signedByName: "X", version: job.version - 1 })
      .expect(409);
    const missing = `org/${owner.user.organization.id}/jobs/${job.id}/signature/${randomUUID()}.png`;
    await tech.agent
      .post(`/api/jobs/${job.id}/complete`)
      .send({ signatureKey: missing, signedByName: "X", version: job.version })
      .expect(400);

    slot += 1;
    const notStarted = await createJob(owner.agent, {
      customerId: customer.id,
      serviceTypeId: service.id,
      technicianId: tech.user.id,
      scheduledStart: new Date(Date.UTC(2033, 0, slot, 9)).toISOString(),
    });
    const sig2 = await upload(notStarted, "SIGNATURE", FAKE_PNG, "image/png");
    await tech.agent
      .post(`/api/jobs/${notStarted.id}/complete`)
      .send({ signatureKey: sig2.key, signedByName: "X", version: notStarted.version })
      .expect(409);
  });
});

describe("checklist items", () => {
  const checklist = [
    { id: "c1", label: "Isolate water", done: false },
    { id: "c2", label: "Test pressure", done: false },
  ];

  it("sets one item absolutely (replay-safe)", async () => {
    const job = await jobInProgress({ checklist });
    const res = await tech.agent.patch(`/api/jobs/${job.id}/checklist/c1`).send({ done: true }).expect(200);
    expect(res.body.checklist).toEqual([{ ...checklist[0], done: true }, checklist[1]]);
    const replay = await tech.agent
      .patch(`/api/jobs/${job.id}/checklist/c1`)
      .send({ done: true })
      .expect(200);
    expect(replay.body.version).toBe(res.body.version);
    await tech.agent.patch(`/api/jobs/${job.id}/checklist/nope`).send({ done: true }).expect(404);
  });

  it("concurrent changes to different items both land (no lost update)", async () => {
    const job = await jobInProgress({ checklist });
    await Promise.all([
      tech.agent.patch(`/api/jobs/${job.id}/checklist/c1`).send({ done: true }).expect(200),
      owner.agent.patch(`/api/jobs/${job.id}/checklist/c2`).send({ done: true }).expect(200),
    ]);
    const final = (await owner.agent.get(`/api/jobs/${job.id}`).expect(200)).body as JobDto;
    expect(final.checklist.every((i) => i.done)).toBe(true);
  });
});

describe("parts used on a job (inventory)", () => {
  async function item(quantity: number) {
    return (
      await owner.agent
        .post("/api/inventory-items")
        .send({
          name: "Pipe fitting",
          sku: `FIT-${randomUUID().slice(0, 6)}`,
          quantity,
          reorderThreshold: 1,
          unitCostMinor: 50_000,
        })
        .expect(201)
    ).body as { id: string; quantity: number };
  }
  const stock = async (id: string) =>
    (
      (await owner.agent.get("/api/inventory-items").query({ pageSize: 100 })).body.items as Array<{
        id: string;
        quantity: number;
      }>
    ).find((i) => i.id === id)!.quantity;

  it("deducts stock; replaying the same part id is a no-op; removing restocks", async () => {
    const job = await jobInProgress();
    const it1 = await item(5);
    const partId = randomUUID();
    const res = await tech.agent
      .post(`/api/jobs/${job.id}/parts`)
      .send({ id: partId, inventoryItemId: it1.id, quantity: 2 })
      .expect(201);
    expect(res.body).toEqual([expect.objectContaining({ id: partId, quantity: 2, unitCostMinor: 50_000 })]);
    expect(await stock(it1.id)).toBe(3);

    await tech.agent
      .post(`/api/jobs/${job.id}/parts`)
      .send({ id: partId, inventoryItemId: it1.id, quantity: 2 })
      .expect(201);
    expect(await stock(it1.id)).toBe(3);

    await tech.agent.delete(`/api/jobs/${job.id}/parts/${partId}`).expect(200);
    expect(await stock(it1.id)).toBe(5);
  });

  it("can't take more than is in stock, even when two technicians race for the last units", async () => {
    const it1 = await item(3);
    const [a, b] = await Promise.all([jobInProgress(), jobInProgress()]);
    const res = await tech.agent
      .post(`/api/jobs/${a.id}/parts`)
      .send({ id: randomUUID(), inventoryItemId: it1.id, quantity: 10 })
      .expect(409);
    expect(res.body.error.message).toMatch(/Only 3/);

    const results = await Promise.all([
      tech.agent
        .post(`/api/jobs/${a.id}/parts`)
        .send({ id: randomUUID(), inventoryItemId: it1.id, quantity: 2 }),
      tech.agent
        .post(`/api/jobs/${b.id}/parts`)
        .send({ id: randomUUID(), inventoryItemId: it1.id, quantity: 2 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stock(it1.id)).toBe(1);
  });

  it("technicians record parts only while the job is in progress", async () => {
    const it1 = await item(5);
    slot += 1;
    const scheduled = await createJob(owner.agent, {
      customerId: customer.id,
      serviceTypeId: service.id,
      technicianId: tech.user.id,
      scheduledStart: new Date(Date.UTC(2033, 0, slot, 9)).toISOString(),
    });
    await tech.agent
      .post(`/api/jobs/${scheduled.id}/parts`)
      .send({ id: randomUUID(), inventoryItemId: it1.id, quantity: 1 })
      .expect(409);
  });
});

describe("inventory items", () => {
  it("filters low stock (column-to-column), enforces unique SKUs, and limits writes to managers", async () => {
    const org = await createOrg(ctx.app);
    const t = await inviteAndAccept(ctx, org.agent, "TECHNICIAN");
    const mk = (sku: string, quantity: number) =>
      org.agent
        .post("/api/inventory-items")
        .send({ name: sku, sku, quantity, reorderThreshold: 5, unitCostMinor: 1 });
    await mk("low-1", 2).expect(201);
    await mk("ok-1", 50).expect(201);
    const dup = await mk("LOW-1", 9).expect(409); // SKUs are normalised to upper case
    expect(dup.body.error.details).toHaveProperty("sku");

    const low = await org.agent.get("/api/inventory-items").query({ lowStock: "true" }).expect(200);
    expect(low.body.items.map((i: { sku: string; lowStock: boolean }) => [i.sku, i.lowStock])).toEqual([
      ["LOW-1", true],
    ]);

    await t.agent.get("/api/inventory-items").expect(200);
    await t.agent
      .post("/api/inventory-items")
      .send({ name: "x", sku: "X1", quantity: 1, reorderThreshold: 0, unitCostMinor: 1 })
      .expect(403);
  });
});
