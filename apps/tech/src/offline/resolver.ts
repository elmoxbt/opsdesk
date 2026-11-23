import { checkTransition, type JobDto, type Role } from "@opsdesk/shared";
import type { OutboxEntry } from "./types";

export type Resolution =
  | { action: "done" } // the server already reflects this change: drop it
  | { action: "retry"; patch: Partial<OutboxEntry> } // still valid: rebase on the latest version and resend
  | { action: "conflict"; message: string }; // can't be applied automatically: ask the technician

const STATUS_WORDS: Record<string, string> = {
  CANCELLED: "was cancelled by the office",
  COMPLETED: "is already completed",
  SCHEDULED: "was moved back to scheduled",
  REQUESTED: "was unscheduled",
};

/**
 * What to do when the server answers 409 to a queued change, given the job as
 * it is NOW on the server. Rules, in order:
 *   1. If the server already has the outcome we wanted, the change is done.
 *   2. If our intent is still valid from the current state, rebase (new version) and retry.
 *   3. Otherwise it's a real conflict a person must see (e.g. the office cancelled the job).
 * Pure function: it's the part of offline sync most worth unit-testing.
 */
export function resolveConflict(
  entry: OutboxEntry,
  latest: JobDto | null,
  actor: { id: string; role: Role },
): Resolution {
  if (!latest) return { action: "conflict", message: "This job is no longer available to you." };
  const job = {
    technicianId: latest.technician?.id ?? null,
    scheduledStart: latest.scheduledStart,
    scheduledEnd: latest.scheduledEnd,
  };

  switch (entry.kind) {
    case "transition": {
      if (latest.status === entry.to) return { action: "done" };
      const ok = checkTransition({ from: latest.status, to: entry.to, actor, job }).ok;
      if (ok) return { action: "retry", patch: { version: latest.version } };
      return {
        action: "conflict",
        message: `Couldn't update: the job ${STATUS_WORDS[latest.status] ?? `is now ${latest.status.toLowerCase()}`}.`,
      };
    }
    case "complete": {
      if (latest.status === "COMPLETED") return { action: "done" };
      if (latest.status === "IN_PROGRESS") return { action: "retry", patch: { version: latest.version } };
      return {
        action: "conflict",
        message: `Couldn't complete: the job ${STATUS_WORDS[latest.status] ?? `is now ${latest.status.toLowerCase()}`}.`,
      };
    }
    case "checklist": {
      const item = latest.checklist.find((i) => i.id === entry.itemId);
      if (!item)
        return {
          action: "conflict",
          message: `"${entry.label}" was removed from the checklist by the office.`,
        };
      if (item.done === entry.done) return { action: "done" };
      return { action: "retry", patch: {} };
    }
    case "addPart":
      return {
        action: "conflict",
        message: `Not enough ${entry.itemName} in stock to record ${entry.quantity}.`,
      };
    default:
      return { action: "conflict", message: "The job changed in a way that needs your attention." };
  }
}
