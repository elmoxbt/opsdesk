import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_DB_OBJECT_BYTES } from "../src/storage/database-storage";
import { StorageService } from "../src/storage/storage.service";
import { createTestApp, FAKE_JPEG, type TestContext } from "./utils";

/**
 * STORAGE_DRIVER=database (serverless demo without S3): the same signed-URL
 * contract as presigned S3, served by our own API from Postgres.
 */
let ctx: TestContext;
let storage: StorageService;
const previous = process.env.STORAGE_DRIVER;
const http = () => request(ctx.app.getHttpServer());
/** Signed URLs carry APP_URL's origin; the test server takes the path and query. */
const path = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

beforeAll(async () => {
  process.env.STORAGE_DRIVER = "database";
  ctx = await createTestApp();
  storage = ctx.app.get(StorageService);
});
afterAll(async () => {
  if (previous === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previous;
  await ctx.close();
});

describe("database storage driver", () => {
  it("uploads and downloads through signed URLs, and HEAD sees the object", async () => {
    const key = `org/${randomUUID()}/jobs/x/photos/a.jpg`;
    const put = await storage.presignPut(key, "image/jpeg");
    await http().put(path(put)).set("Content-Type", "image/jpeg").send(Buffer.from(FAKE_JPEG)).expect(200);
    expect(await storage.head(key)).toEqual({ sizeBytes: FAKE_JPEG.length, contentType: "image/jpeg" });

    const get = await storage.presignGet(key, 60, "INV-0001.pdf");
    const res = await http().get(path(get)).buffer(true).expect(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["content-disposition"]).toContain("INV-0001.pdf");
    expect(Buffer.from(res.body as Buffer)).toEqual(Buffer.from(FAKE_JPEG));

    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    await http().get(path(get)).expect(404);
  });

  it("refuses tampered, expired, wrong-method and wrong-type requests", async () => {
    const key = `org/${randomUUID()}/a.png`;
    const put = path(await storage.presignPut(key, "image/png"));
    // The signature covers the content type…
    await http().put(put).set("Content-Type", "image/jpeg").send(Buffer.from(FAKE_JPEG)).expect(403);
    // …the key (swap in another object's key)…
    const other = Buffer.from(`org/${randomUUID()}/b.png`).toString("base64url");
    await http()
      .put(put.replace(/\/o\/[^?]+/, `/o/${other}`))
      .set("Content-Type", "image/png")
      .send(Buffer.from("x"))
      .expect(403);
    // …and the method: an upload URL can't be used to download.
    await http().get(put.replace("m=PUT", "m=GET")).expect(403);
    // Expired.
    const expired = path(await storage.presignPut(key, "image/png", -5));
    await http().put(expired).set("Content-Type", "image/png").send(Buffer.from("x")).expect(403);
    expect(await storage.head(key)).toBeNull();
  });

  it("caps uploads at the serverless body limit", async () => {
    const key = `org/${randomUUID()}/big.jpg`;
    const put = path(await storage.presignPut(key, "image/jpeg"));
    await http()
      .put(put)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.alloc(MAX_DB_OBJECT_BYTES + 10))
      .expect(400);
    expect(await storage.head(key)).toBeNull();
  });

  it("stores server-generated files (PDFs) the same way", async () => {
    const key = `org/${randomUUID()}/invoices/i/v1.pdf`;
    await storage.put(key, Buffer.from("%PDF-1.7 test"), "application/pdf");
    const res = await http()
      .get(path(await storage.presignGet(key)))
      .buffer(true)
      .expect(200);
    expect(
      Buffer.from(res.body as Buffer)
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
  });
});
