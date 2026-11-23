import type { JobDto, JobStatus } from "@opsdesk/shared";
import type { OutboxEntry } from "./types";

/**
 * What the technician should SEE: the last server copy of the job with their
 * still-queued changes applied on top (optimistic UI that survives reloads,
 * because the queue is persisted). Pure, so it's unit-tested.
 */
export function applyPending(job: JobDto, entries: readonly OutboxEntry[]): JobDto {
  let status: JobStatus = job.status;
  let checklist = job.checklist;
  for (const e of [...entries].sort((a, b) => a.createdAt - b.createdAt)) {
    if (e.jobId !== job.id || e.state !== "pending") continue;
    if (e.kind === "transition") status = e.to;
    if (e.kind === "complete") status = "COMPLETED";
    if (e.kind === "checklist")
      checklist = checklist.map((i) => (i.id === e.itemId ? { ...i, done: e.done } : i));
  }
  return status === job.status && checklist === job.checklist ? job : { ...job, status, checklist };
}

export const pendingFor = (jobId: string, entries: readonly OutboxEntry[]) =>
  entries.filter((e) => e.jobId === jobId);
