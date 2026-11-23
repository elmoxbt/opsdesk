import { api, ApiError, type JobDto, type UploadTicketDto } from "@opsdesk/shared";
import { type Executor, type OutboxEntry, RetryableError } from "./types";

/** Never start a PUT on a URL that's about to expire mid-upload on a slow connection. */
const EXPIRY_MARGIN_MS = 30_000;
const usable = (t: UploadTicketDto | undefined): t is UploadTicketDto =>
  !!t && Date.parse(t.expiresAt) - Date.now() > EXPIRY_MARGIN_MS;

async function ticketFor(
  entry: OutboxEntry & { ticket?: UploadTicketDto },
  kind: "BEFORE" | "AFTER" | "SIGNATURE",
  blob: Blob,
  contentType: string,
  update: (patch: Partial<OutboxEntry>) => Promise<void>,
): Promise<UploadTicketDto> {
  if (usable(entry.ticket)) return entry.ticket;
  const ticket = await api<UploadTicketDto>(`/jobs/${entry.jobId}/uploads`, {
    method: "POST",
    body: { kind, contentType, sizeBytes: blob.size },
    // A new key per attempt: a replayed (stored) ticket could hold an already-expired URL.
    idempotencyKey: `${entry.id}-ticket-${entry.attempts}`,
  });
  await update({ ticket } as Partial<OutboxEntry>);
  return ticket;
}

/** Straight to S3. 403 = the presigned URL expired (or the clock is off): start over with a fresh one. */
async function putToStorage(ticket: UploadTicketDto, blob: Blob): Promise<void> {
  const res = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: blob });
  if (res.status === 403 || res.status === 400) throw new RetryableError("Upload link expired");
  if (!res.ok)
    throw new ApiError(res.status, res.status >= 500 ? "INTERNAL" : "BAD_REQUEST", "Upload failed");
}

/** Runs one queued change against the API. Every request carries the entry's id as Idempotency-Key. */
export const execute: Executor = async (entry, update) => {
  const job = entry.jobId;
  switch (entry.kind) {
    case "transition":
      return api<JobDto>(`/jobs/${job}/transitions`, {
        method: "POST",
        body: { to: entry.to, version: entry.version },
        idempotencyKey: entry.id,
      });
    case "checklist":
      return api<JobDto>(`/jobs/${job}/checklist/${encodeURIComponent(entry.itemId)}`, {
        method: "PATCH",
        body: { done: entry.done },
        idempotencyKey: entry.id,
      });
    case "addPart":
      await api(`/jobs/${job}/parts`, {
        method: "POST",
        body: { id: entry.partId, inventoryItemId: entry.inventoryItemId, quantity: entry.quantity },
        idempotencyKey: entry.id,
      });
      return;
    case "removePart":
      await api(`/jobs/${job}/parts/${entry.partId}`, { method: "DELETE", idempotencyKey: entry.id });
      return;
    case "photo": {
      const ticket = await ticketFor(entry, entry.photoKind, entry.blob, entry.contentType, update);
      try {
        await putToStorage(ticket, entry.blob);
      } catch (e) {
        if (e instanceof RetryableError) await update({ ticket: undefined } as Partial<OutboxEntry>);
        throw e;
      }
      await api(`/jobs/${job}/photos`, {
        method: "POST",
        body: { key: ticket.key, kind: entry.photoKind },
        idempotencyKey: entry.id,
      });
      return;
    }
    case "complete": {
      let signatureKey = entry.signatureKey;
      if (!signatureKey) {
        const ticket = await ticketFor(entry, "SIGNATURE", entry.signature, "image/png", update);
        try {
          await putToStorage(ticket, entry.signature);
        } catch (e) {
          if (e instanceof RetryableError) await update({ ticket: undefined } as Partial<OutboxEntry>);
          throw e;
        }
        signatureKey = ticket.key;
        await update({ signatureKey } as Partial<OutboxEntry>); // don't re-upload if completion needs a retry
      }
      return api<JobDto>(`/jobs/${job}/complete`, {
        method: "POST",
        body: { signatureKey, signedByName: entry.signedByName, version: entry.version },
        idempotencyKey: entry.id,
      });
    }
  }
};
