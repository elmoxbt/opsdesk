import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env";
import { QueueService } from "./queue.service";

const env = loadEnv({
  DATABASE_URL: "postgresql://u:p@localhost/db",
  JWT_ACCESS_SECRET: "x".repeat(32),
  NODE_ENV: "test",
});

async function started(): Promise<QueueService> {
  const q = new QueueService(env);
  return q;
}

describe("QueueService (inline driver)", () => {
  it("runs jobs after the caller returns, retries failures, and dedupes by jobId", async () => {
    const q = await started();
    const seen: number[] = [];
    let failures = 2;
    q.register("invoice.render-pdf", async (p) => {
      if (failures-- > 0) throw new Error("flaky S3");
      seen.push(p.version);
    });
    await q.onApplicationBootstrap();

    const payload = { organizationId: "o", invoiceId: "i", version: 1 };
    await q.enqueue("invoice.render-pdf", payload, { jobId: "pdf-i-v1" });
    await q.enqueue("invoice.render-pdf", payload, { jobId: "pdf-i-v1" }); // duplicate: ignored
    expect(seen).toEqual([]); // not run synchronously
    await q.drain();
    expect(seen).toEqual([1]);
    await q.onApplicationShutdown();
  });

  it("refuses two handlers for one job name", () => {
    const q = new QueueService(env);
    q.register("invoices.overdue-reminders", async () => {});
    expect(() => q.register("invoices.overdue-reminders", async () => {})).toThrow(/Duplicate/);
  });
});
