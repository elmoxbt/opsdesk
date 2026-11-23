import type { JobDto, JobStatus, UploadTicketDto } from "@opsdesk/shared";

/**
 * A change the technician made, persisted in IndexedDB until the server has it.
 * The queue stores COMMANDS ("set checklist item c1 done", "start job"), not
 * snapshots of the job, so they can be replayed against whatever the server
 * state is by then, and conflicts are about intent, not about fields.
 */
interface Base {
  /** Device-generated UUID. Doubles as the Idempotency-Key, so a replay is never applied twice. */
  id: string;
  jobId: string;
  /**
   * Who made the change. The queue outlives sign-out (unsynced work must not be
   * lost), so on a shared device the engine must only ever replay entries
   * belonging to whoever is signed in now, never under someone else's session.
   */
  userId: string;
  createdAt: number;
  attempts: number;
  state: "pending" | "conflict" | "failed";
  /** Shown to the technician when state isn't "pending". */
  error?: string;
}

export type OutboxEntry =
  | (Base & { kind: "transition"; to: JobStatus; version: number })
  | (Base & { kind: "checklist"; itemId: string; label: string; done: boolean })
  | (Base & { kind: "addPart"; partId: string; inventoryItemId: string; itemName: string; quantity: number })
  | (Base & { kind: "removePart"; partId: string })
  | (Base & {
      kind: "photo";
      photoKind: "BEFORE" | "AFTER";
      blob: Blob;
      contentType: string;
      /** Filled in during sync; tickets expire, so they're never requested while offline. */
      ticket?: UploadTicketDto;
    })
  | (Base & {
      kind: "complete";
      version: number;
      signedByName: string;
      signature: Blob;
      /** Set once the signature has been uploaded (so a retry doesn't re-upload). */
      signatureKey?: string;
      ticket?: UploadTicketDto;
    });

export type OutboxKind = OutboxEntry["kind"];

/** Storage for the queue. IndexedDB in the app, an in-memory Map in tests. */
export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Runs one entry against the API. Returns the updated job when the endpoint returns one. */
export type Executor = (
  entry: OutboxEntry,
  update: (patch: Partial<OutboxEntry>) => Promise<void>,
) => Promise<JobDto | void>;

/** Thrown by an executor when a step must be redone from scratch (e.g. an expired upload URL). */
export class RetryableError extends Error {}
