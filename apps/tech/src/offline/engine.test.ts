import { ApiError, type JobDto } from "@opsdesk/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOutboxStore, SyncEngine } from "./engine";
import { applyPending } from "./overlay";
import { resolveConflict } from "./resolver";
import { type OutboxEntry, RetryableError } from "./types";

const tech = { id: "tech-1", role: "TECHNICIAN" as const };
const job = (over: Partial<JobDto> = {}): JobDto =>
  ({
    id: "job-1",
    number: 7,
    status: "SCHEDULED",
    version: 1,
    technician: { id: "tech-1", name: "Chidi", avatarUrl: null },
    scheduledStart: "2030-01-01T09:00:00Z",
    scheduledEnd: "2030-01-01T10:00:00Z",
    checklist: [{ id: "c1", label: "Isolate water", done: false }],
    ...over,
  }) as JobDto;

let seq = 0;
const entry = (e: Partial<OutboxEntry> & Pick<OutboxEntry, "kind">): OutboxEntry =>
  ({
    id: `e${++seq}`,
    jobId: "job-1",
    userId: "tech-1",
    createdAt: seq,
    attempts: 0,
    state: "pending",
    ...e,
  }) as OutboxEntry;

const conflict = () => new ApiError(409, "CONFLICT", "changed");

describe("resolveConflict", () => {
  it("transition: done if the server is already there, rebase if still valid, conflict otherwise", () => {
    const e = entry({ kind: "transition", to: "EN_ROUTE", version: 1 });
    expect(resolveConflict(e, job({ status: "EN_ROUTE", version: 3 }), tech)).toEqual({ action: "done" });
    expect(resolveConflict(e, job({ status: "SCHEDULED", version: 3 }), tech)).toEqual({
      action: "retry",
      patch: { version: 3 },
    });
    expect(resolveConflict(e, job({ status: "CANCELLED", version: 3 }), tech)).toMatchObject({
      action: "conflict",
      message: expect.stringMatching(/cancelled by the office/),
    });
  });

  it("complete: done if completed, rebase if still in progress", () => {
    const e = entry({ kind: "complete", version: 2, signedByName: "X", signature: new Blob() });
    expect(resolveConflict(e, job({ status: "COMPLETED" }), tech)).toEqual({ action: "done" });
    expect(resolveConflict(e, job({ status: "IN_PROGRESS", version: 5 }), tech)).toEqual({
      action: "retry",
      patch: { version: 5 },
    });
    expect(resolveConflict(e, job({ status: "CANCELLED" }), tech).action).toBe("conflict");
  });

  it("checklist: conflict if the office removed the item", () => {
    const e = entry({ kind: "checklist", itemId: "gone", label: "Old step", done: true });
    expect(resolveConflict(e, job(), tech)).toMatchObject({
      action: "conflict",
      message: expect.stringMatching(/Old step/),
    });
  });

  it("a job that's no longer visible is a conflict", () => {
    expect(
      resolveConflict(entry({ kind: "transition", to: "EN_ROUTE", version: 1 }), null, tech).action,
    ).toBe("conflict");
  });
});

describe("SyncEngine", () => {
  let store: MemoryOutboxStore;
  beforeEach(() => {
    store = new MemoryOutboxStore();
  });
  const engine = (execute: SyncEngineExecute, fetchJob = vi.fn(async () => job())) =>
    new SyncEngine({ store, execute, fetchJob, actor: () => tech });
  type SyncEngineExecute = ConstructorParameters<typeof SyncEngine>[0]["execute"];

  it("sends entries in creation order and removes them when accepted", async () => {
    const order: string[] = [];
    await store.put(
      entry({ kind: "checklist", itemId: "c1", label: "x", done: true, createdAt: 2, id: "b" }),
    );
    await store.put(entry({ kind: "transition", to: "EN_ROUTE", version: 1, createdAt: 1, id: "a" }));
    await engine(async (e) => void order.push(e.id)).flush();
    expect(order).toEqual(["a", "b"]);
    expect(await store.all()).toEqual([]);
  });

  it("stops at a network failure and keeps the whole queue, in order", async () => {
    await store.put(entry({ kind: "transition", to: "EN_ROUTE", version: 1, id: "a" }));
    await store.put(entry({ kind: "transition", to: "IN_PROGRESS", version: 2, id: "b" }));
    const execute = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const states: string[] = [];
    await new SyncEngine({
      store,
      execute,
      fetchJob: async () => job(),
      actor: () => tech,
      onState: (s) => states.push(s),
    }).flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await store.all()).map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(states.at(-1)).toBe("offline");
  });

  it("on 409, rebases onto the latest version and retries", async () => {
    await store.put(entry({ kind: "transition", to: "EN_ROUTE", version: 1 }));
    const versions: number[] = [];
    await engine(
      async (e) => {
        if (e.kind !== "transition") return;
        versions.push(e.version);
        if (e.version === 1) throw conflict();
      },
      vi.fn(async () => job({ version: 4 })),
    ).flush();
    expect(versions).toEqual([1, 4]);
    expect(await store.all()).toEqual([]);
  });

  it("a real conflict is kept for the technician, and blocks later changes to the SAME job only", async () => {
    await store.put(
      entry({ kind: "transition", to: "IN_PROGRESS", version: 1, id: "start", jobId: "job-1" }),
    );
    await store.put(
      entry({
        kind: "complete",
        version: 2,
        signedByName: "X",
        signature: new Blob(),
        id: "finish",
        jobId: "job-1",
      }),
    );
    await store.put(
      entry({ kind: "checklist", itemId: "c1", label: "x", done: true, id: "other", jobId: "job-2" }),
    );
    const ran: string[] = [];
    await engine(
      async (e) => {
        ran.push(e.id);
        if (e.id === "start") throw conflict();
      },
      vi.fn(async () => job({ status: "CANCELLED" })),
    ).flush();
    expect(ran).toEqual(["start", "other"]); // "finish" never ran ahead of the failed start
    const left = await store.all();
    expect(left.find((e) => e.id === "start")).toMatchObject({
      state: "conflict",
      error: expect.stringMatching(/cancelled/),
    });
    expect(left.find((e) => e.id === "finish")).toMatchObject({ state: "pending" });
    expect(left.find((e) => e.id === "other")).toBeUndefined();
  });

  it("retries a step that must be redone (expired upload URL) up to the limit, persisting progress", async () => {
    await store.put(
      entry({
        kind: "photo",
        photoKind: "BEFORE",
        blob: new Blob(["x"]),
        contentType: "image/jpeg",
        id: "p",
      }),
    );
    let calls = 0;
    await engine(async (e, update) => {
      calls++;
      await update({
        ticket: { uploadUrl: `u${calls}`, key: "k", headers: {}, expiresAt: "" },
      } as Partial<OutboxEntry>);
      if (calls === 1) throw new RetryableError("expired");
      expect(e.attempts).toBe(1);
    }).flush();
    expect(calls).toBe(2);
    expect(await store.all()).toEqual([]);
  });

  it("validation errors become 'failed' with the server's message", async () => {
    await store.put(entry({ kind: "checklist", itemId: "c1", label: "x", done: true }));
    await engine(async () => {
      throw new ApiError(400, "BAD_REQUEST", "This job is closed");
    }).flush();
    expect((await store.all())[0]).toMatchObject({ state: "failed", error: "This job is closed" });
  });

  it("never replays another user's queued changes (shared device after sign-out)", async () => {
    await store.put(
      entry({ kind: "transition", to: "EN_ROUTE", version: 1, id: "theirs", userId: "tech-2" }),
    );
    await store.put(entry({ kind: "transition", to: "EN_ROUTE", version: 1, id: "mine" }));
    const ran: string[] = [];
    await engine(async (e) => void ran.push(e.id)).flush();
    expect(ran).toEqual(["mine"]);
    expect((await store.all()).map((e) => e.id)).toEqual(["theirs"]); // kept for its owner
  });

  it("concurrent flush() calls share one run", async () => {
    await store.put(entry({ kind: "transition", to: "EN_ROUTE", version: 1 }));
    const execute = vi.fn(async () => undefined);
    const e = engine(execute);
    await Promise.all([e.flush(), e.flush(), e.flush()]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("applyPending (optimistic view)", () => {
  it("overlays queued status and checklist changes in order, ignoring other jobs and stuck entries", () => {
    const base = job();
    const view = applyPending(base, [
      entry({ kind: "transition", to: "EN_ROUTE", version: 1, createdAt: 1 }),
      entry({ kind: "transition", to: "IN_PROGRESS", version: 2, createdAt: 2 }),
      entry({ kind: "checklist", itemId: "c1", label: "x", done: true, createdAt: 3 }),
      entry({ kind: "transition", to: "CANCELLED", version: 9, createdAt: 4, jobId: "job-2" }),
      entry({ kind: "transition", to: "COMPLETED", version: 9, createdAt: 5, state: "conflict" }),
    ]);
    expect(view.status).toBe("IN_PROGRESS");
    expect(view.checklist[0]!.done).toBe(true);
    expect(base.status).toBe("SCHEDULED"); // not mutated
  });

  it("returns the same object when nothing is pending", () => {
    const base = job();
    expect(applyPending(base, [])).toBe(base);
  });
});
