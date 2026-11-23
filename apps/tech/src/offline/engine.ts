import { ApiError, type JobDto, type Role } from "@opsdesk/shared";
import { resolveConflict } from "./resolver";
import { type Executor, type OutboxEntry, type OutboxStore, RetryableError } from "./types";

export type SyncState = "idle" | "syncing" | "offline" | "error";

export interface SyncEngineOptions {
  store: OutboxStore;
  execute: Executor;
  fetchJob: (jobId: string) => Promise<JobDto | null>;
  actor: () => { id: string; role: Role } | null;
  /** Called after each change the server accepted (to refresh caches). */
  onApplied?: (entry: OutboxEntry, job: JobDto | void) => void;
  onState?: (state: SyncState) => void;
  maxAttempts?: number;
}

/** fetch() rejects with a TypeError when there's no network at all (vs. an HTTP error status). */
export const isNetworkError = (e: unknown): boolean =>
  e instanceof TypeError || (e instanceof Error && e.name === "AbortError");

/**
 * Drains the outbox in creation order.
 * - Network down → stop; everything stays queued in order (retried on `online` / timer).
 * - 409 → ask the resolver: done / rebase + retry / conflict.
 * - A failed or conflicted entry blocks LATER entries for the same job (so
 *   "complete" never runs before a "start" that didn't go through). Other jobs continue.
 * - 5xx/429 → stop and retry later (backoff is the caller's timer).
 * Only one flush runs at a time; concurrent calls share it.
 */
export class SyncEngine {
  private running: Promise<void> | null = null;
  private readonly max: number;

  constructor(private readonly o: SyncEngineOptions) {
    this.max = o.maxAttempts ?? 3;
  }

  flush(): Promise<void> {
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    const actor = this.o.actor();
    if (!actor) return;
    const queue = (await this.o.store.all())
      .filter((e) => e.userId === actor.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    const blocked = new Set(queue.filter((e) => e.state !== "pending").map((e) => e.jobId));
    if (!queue.some((e) => e.state === "pending")) return this.o.onState?.("idle");
    this.o.onState?.("syncing");

    for (let entry of queue) {
      if (entry.state !== "pending" || blocked.has(entry.jobId)) continue;
      // Each entry may need a couple of rounds (rebase after 409, fresh upload URL).
      for (;;) {
        // Always merge onto the LATEST copy: one execution may persist several
        // steps (upload ticket, then signature key) and none may be lost.
        const update = async (patch: Partial<OutboxEntry>) => {
          entry = { ...entry, ...patch } as OutboxEntry;
          await this.o.store.put(entry);
        };
        try {
          const job = await this.o.execute(entry, update);
          await this.o.store.delete(entry.id);
          this.o.onApplied?.(entry, job);
          break;
        } catch (err) {
          if (isNetworkError(err)) return this.o.onState?.("offline");
          if (err instanceof ApiError && (err.status >= 500 || err.status === 429 || err.status === 401)) {
            return this.o.onState?.("error");
          }
          const attempts = entry.attempts + 1;
          if (err instanceof RetryableError && attempts < this.max) {
            await update({ attempts });
            continue;
          }
          if (err instanceof ApiError && err.status === 409 && attempts < this.max) {
            const r = resolveConflict(entry, await this.o.fetchJob(entry.jobId).catch(() => null), actor);
            if (r.action === "done") {
              await this.o.store.delete(entry.id);
              this.o.onApplied?.(entry);
              break;
            }
            if (r.action === "retry") {
              await update({ ...r.patch, attempts });
              continue;
            }
            await update({ state: "conflict", error: r.message, attempts });
          } else {
            const message = err instanceof Error ? err.message : "Couldn't sync this change";
            await update({ state: "failed", error: message, attempts });
          }
          blocked.add(entry.jobId);
          break;
        }
      }
    }
    const mine = (await this.o.store.all()).filter((e) => e.userId === actor.id);
    this.o.onState?.(mine.some((e) => e.state !== "pending") ? "error" : "idle");
  }
}

/** In-memory store (tests, and a fallback when IndexedDB is unavailable, e.g. private mode). */
export class MemoryOutboxStore implements OutboxStore {
  private readonly map = new Map<string, OutboxEntry>();
  async all() {
    return [...this.map.values()];
  }
  async put(e: OutboxEntry) {
    this.map.set(e.id, e);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
}
