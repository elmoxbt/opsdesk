import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { currentOrganizationId, type JobStatus, Prisma } from "@opsdesk/db";
import {
  type AddPartInput,
  checkTransition,
  type CompleteJobInput,
  type ConfirmPhotoInput,
  type JobDto,
  type JobMediaDto,
  type JobPartDto,
  MAX_UPLOAD_BYTES,
  PHOTO_CONTENT_TYPES,
  type UploadRequest,
  type UploadTicketDto,
} from "@opsdesk/shared";
import { AuditService } from "../audit/audit.service";
import { StockAlertService } from "../inventory/stock-alert.service";
import type { RequestUser } from "../auth/auth.types";
import { AppException } from "../common/app-exception";
import { iso } from "../common/mapping";
import { PrismaService } from "../prisma/prisma.service";
import { type ObjectHead, StorageService } from "../storage/storage.service";
import { jobInclude, JobsService, toJobDto } from "./jobs.service";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const CLOSED: readonly JobStatus[] = ["CANCELLED", "INVOICED", "PAID"];
const STALE = "This job was changed by someone else. Reload to see the latest version.";

/** Keys are namespaced by tenant and job, so a confirm can prove the object belongs here. */
export const objectPrefix = (orgId: string, jobId: string, kind: string) =>
  `org/${orgId}/jobs/${jobId}/${kind.toLowerCase()}/`;

/**
 * Work done on site: photos, signature + completion, parts used, checklist.
 * Every operation here is safe to replay, because the technician app may send
 * it twice (offline queue + flaky network): photos are keyed by their S3 key,
 * parts by a device-generated id, checklist toggles set an absolute value, and
 * completion is idempotent once the job is complete with that signature.
 */
@Injectable()
export class JobFieldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly stockAlerts: StockAlertService,
  ) {}

  // ---- Uploads ---------------------------------------------------------------

  async createUpload(jobId: string, input: UploadRequest, actor: RequestUser): Promise<UploadTicketDto> {
    const job = await this.jobs.findVisible(this.prisma.db, jobId, actor);
    if (CLOSED.includes(job.status)) throw new AppException("CONFLICT", "This job is closed");
    const key = `${objectPrefix(currentOrganizationId(), job.id, input.kind)}${randomUUID()}.${EXT[input.contentType]}`;
    const expiresIn = 300;
    return {
      uploadUrl: await this.storage.presignPut(key, input.contentType, expiresIn),
      key,
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  /** Verifies the uploaded object (it's ours, it exists, right size/type) before recording it. */
  async confirmPhoto(jobId: string, input: ConfirmPhotoInput, actor: RequestUser): Promise<JobMediaDto> {
    const job = await this.jobs.findVisible(this.prisma.db, jobId, actor);
    if (CLOSED.includes(job.status)) throw new AppException("CONFLICT", "This job is closed");
    const head = await this.verifyObject(
      input.key,
      objectPrefix(currentOrganizationId(), job.id, input.kind),
    );
    try {
      await this.prisma.db.$transaction(async (tx) => {
        const photo = await tx.jobPhoto.create({
          data: {
            organizationId: currentOrganizationId(),
            jobId: job.id,
            kind: input.kind,
            s3Key: input.key,
            contentType: head.contentType ?? "application/octet-stream",
            sizeBytes: head.sizeBytes,
            uploadedById: actor.id,
          },
        });
        await this.audit.record(
          {
            action: "job.photo_added",
            entityType: "Job",
            entityId: job.id,
            after: { photoId: photo.id, kind: input.kind },
          },
          tx,
        );
      });
    } catch (e) {
      // Replayed confirm for an already-recorded photo: success, not an error.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
    this.jobs.publish("media", toJobDto(job), actor, null);
    return this.media(jobId, actor);
  }

  async deletePhoto(jobId: string, photoId: string, actor: RequestUser): Promise<void> {
    const job = await this.jobs.findVisible(this.prisma.db, jobId, actor);
    const photo = await this.prisma.db.jobPhoto.findFirst({ where: { id: photoId, jobId } });
    if (!photo) throw new AppException("NOT_FOUND", "Photo not found");
    if (actor.role === "TECHNICIAN" && (photo.uploadedById !== actor.id || job.status === "COMPLETED")) {
      throw new AppException("FORBIDDEN", "You can only remove your own photos before the job is completed");
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.jobPhoto.delete({ where: { id: photo.id } });
      await this.audit.record(
        {
          action: "job.photo_removed",
          entityType: "Job",
          entityId: jobId,
          before: { photoId, kind: photo.kind },
        },
        tx,
      );
    });
    // After commit: if deleting the object fails, a lifecycle rule sweeps orphans; the record is already gone.
    await this.storage.delete(photo.s3Key).catch(() => undefined);
    this.jobs.publish("media", toJobDto(job), actor, null);
  }

  async media(jobId: string, actor: RequestUser): Promise<JobMediaDto> {
    await this.jobs.findVisible(this.prisma.db, jobId, actor);
    const [photos, signature] = await Promise.all([
      this.prisma.db.jobPhoto.findMany({
        where: { jobId },
        include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.db.signature.findFirst({ where: { jobId } }),
    ]);
    return {
      photos: await Promise.all(
        photos.map(async (p) => ({
          id: p.id,
          kind: p.kind,
          url: await this.storage.presignGet(p.s3Key),
          contentType: p.contentType,
          uploadedBy: p.uploadedBy,
          createdAt: iso(p.createdAt),
        })),
      ),
      signature: signature
        ? {
            url: await this.storage.presignGet(signature.s3Key),
            signedByName: signature.signedByName,
            signedAt: iso(signature.signedAt),
          }
        : null,
    };
  }

  // ---- Completion ------------------------------------------------------------

  /** IN_PROGRESS → COMPLETED with the customer's signature, atomically. */
  async complete(jobId: string, input: CompleteJobInput, actor: RequestUser): Promise<JobDto> {
    const job = await this.jobs.findVisible(this.prisma.db, jobId, actor);
    // Replay of a completion that already succeeded with this signature → same result.
    if (job.status === "COMPLETED") {
      const sig = await this.prisma.db.signature.findFirst({ where: { jobId } });
      if (sig?.s3Key === input.signatureKey) return toJobDto(job);
    }
    if (job.version !== input.version) throw new AppException("CONFLICT", STALE);
    const check = checkTransition({ from: job.status, to: "COMPLETED", actor, job });
    if (!check.ok)
      throw new AppException(check.code === "FORBIDDEN" ? "FORBIDDEN" : "CONFLICT", check.message);
    await this.verifyObject(input.signatureKey, objectPrefix(currentOrganizationId(), job.id, "SIGNATURE"));

    const done = await this.prisma.db.$transaction(async (tx) => {
      const res = await tx.job.updateMany({
        where: { id: jobId, status: "IN_PROGRESS", version: input.version },
        data: { status: "COMPLETED", completedAt: new Date(), version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppException("CONFLICT", STALE);
      await tx.signature.create({
        data: {
          organizationId: currentOrganizationId(),
          jobId,
          s3Key: input.signatureKey,
          signedByName: input.signedByName,
        },
      });
      await this.audit.record(
        {
          action: "job.status_changed",
          entityType: "Job",
          entityId: jobId,
          before: { status: "IN_PROGRESS" },
          after: { status: "COMPLETED", signedBy: input.signedByName },
        },
        tx,
      );
      return toJobDto(await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude }));
    });
    this.jobs.publish("status_changed", done, actor, null);
    return done;
  }

  // ---- Parts -----------------------------------------------------------------

  async parts(jobId: string, actor: RequestUser): Promise<JobPartDto[]> {
    await this.jobs.findVisible(this.prisma.db, jobId, actor);
    const rows = await this.prisma.db.jobPart.findMany({
      where: { jobId },
      include: { inventoryItem: { select: { id: true, name: true, sku: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      item: r.inventoryItem,
      quantity: r.quantity,
      unitCostMinor: r.unitCostMinor,
      createdAt: iso(r.createdAt),
    }));
  }

  /**
   * Records parts used and deducts stock in ONE transaction. The decrement is
   * conditional (`quantity >= n`), so two technicians can't both take the last unit.
   */
  async addPart(
    jobId: string,
    input: AddPartInput & { quantity: number },
    actor: RequestUser,
  ): Promise<JobPartDto[]> {
    const job = await this.jobs.findVisible(this.prisma.db, jobId, actor);
    const existing = await this.prisma.db.jobPart.findFirst({ where: { id: input.id } });
    if (existing) {
      if (existing.jobId !== jobId) throw new AppException("CONFLICT", "That part id is already used");
      return this.parts(jobId, actor); // replay
    }
    this.assertPartsEditable(job.status, actor);

    await this.prisma.db.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: input.inventoryItemId } });
      if (!item)
        throw new AppException("VALIDATION_FAILED", "Part not found", {
          inventoryItemId: ["Part not found"],
        });
      const taken = await tx.inventoryItem.updateMany({
        where: { id: item.id, quantity: { gte: input.quantity } },
        data: { quantity: { decrement: input.quantity } },
      });
      if (taken.count === 0) {
        throw new AppException("CONFLICT", `Only ${item.quantity} × ${item.name} left in stock`, {
          quantity: [`Only ${item.quantity} in stock`],
        });
      }
      await tx.jobPart.create({
        data: {
          id: input.id,
          organizationId: currentOrganizationId(),
          jobId,
          inventoryItemId: item.id,
          quantity: input.quantity,
          unitCostMinor: item.unitCostMinor, // snapshot: later price changes don't rewrite this job
        },
      });
      await this.audit.record(
        {
          action: "job.part_added",
          entityType: "Job",
          entityId: jobId,
          after: { partId: input.id, sku: item.sku, quantity: input.quantity },
        },
        tx,
      );
    });
    await this.stockAlerts.check(input.inventoryItemId);
    this.jobs.publish("parts", toJobDto(job), actor, null);
    return this.parts(jobId, actor);
  }

  /** Undo a mistaken part: stock goes back. Idempotent (already gone → fine). */
  async removePart(jobId: string, partId: string, actor: RequestUser): Promise<JobPartDto[]> {
    const job = await this.jobs.findVisible(this.prisma.db, jobId, actor);
    this.assertPartsEditable(job.status, actor);
    const restocked = await this.prisma.db.$transaction(async (tx) => {
      const part = await tx.jobPart.findFirst({ where: { id: partId, jobId } });
      if (!part) return null;
      await tx.jobPart.delete({ where: { id: part.id } });
      await tx.inventoryItem.update({
        where: { id: part.inventoryItemId },
        data: { quantity: { increment: part.quantity } },
      });
      await this.audit.record(
        {
          action: "job.part_removed",
          entityType: "Job",
          entityId: jobId,
          before: { partId, quantity: part.quantity },
        },
        tx,
      );
      return part.inventoryItemId;
    });
    if (restocked) await this.stockAlerts.check(restocked);
    this.jobs.publish("parts", toJobDto(job), actor, null);
    return this.parts(jobId, actor);
  }

  // ---- Checklist -------------------------------------------------------------

  /**
   * Sets ONE item's `done` (absolute, not a toggle, so a replay is harmless).
   * Changes to different items commute, so no version is required from the
   * client; a compare-and-swap retry loop handles concurrent writers server-side.
   */
  async setChecklistItem(jobId: string, itemId: string, done: boolean, actor: RequestUser): Promise<JobDto> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = await this.jobs.findVisible(this.prisma.db, jobId, actor);
      if (CLOSED.includes(job.status)) throw new AppException("CONFLICT", "This job is closed");
      const items = toJobDto(job).checklist;
      const item = items.find((i) => i.id === itemId);
      if (!item) throw new AppException("NOT_FOUND", "Checklist item not found");
      if (item.done === done) return toJobDto(job);

      const next = items.map((i) => (i.id === itemId ? { ...i, done } : i));
      const updated = await this.prisma.db.$transaction(async (tx) => {
        const res = await tx.job.updateMany({
          where: { id: jobId, version: job.version },
          data: { checklist: next, version: { increment: 1 } },
        });
        if (res.count === 0) return null; // someone else wrote in between: re-read and retry
        await this.audit.record(
          {
            action: "job.checklist_item",
            entityType: "Job",
            entityId: jobId,
            after: { item: item.label, done },
          },
          tx,
        );
        return toJobDto(await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude }));
      });
      if (updated) {
        this.jobs.publish("updated", updated, actor, null);
        return updated;
      }
    }
    throw new AppException("CONFLICT", "The checklist is being changed by someone else. Try again.");
  }

  // ---------------------------------------------------------------------------

  private assertPartsEditable(status: JobStatus, actor: RequestUser): void {
    if (actor.role === "TECHNICIAN" ? status !== "IN_PROGRESS" : CLOSED.includes(status)) {
      throw new AppException(
        "CONFLICT",
        actor.role === "TECHNICIAN"
          ? "Parts can be recorded while the job is in progress"
          : "This job is closed",
      );
    }
  }

  private async verifyObject(key: string, prefix: string): Promise<ObjectHead> {
    if (!key.startsWith(prefix) || key.includes("..")) {
      throw new AppException("VALIDATION_FAILED", "That upload doesn't belong to this job", {
        key: ["Invalid upload key"],
      });
    }
    const head = await this.storage.head(key);
    if (!head)
      throw new AppException("VALIDATION_FAILED", "Upload not found. Try uploading again.", {
        key: ["Upload not found"],
      });
    if (
      head.sizeBytes > MAX_UPLOAD_BYTES ||
      !(PHOTO_CONTENT_TYPES as readonly string[]).includes(head.contentType ?? "")
    ) {
      await this.storage.delete(key).catch(() => undefined);
      throw new AppException("VALIDATION_FAILED", "Images must be JPEG, PNG or WebP and at most 10 MB", {
        key: ["Rejected upload"],
      });
    }
    return head;
  }
}
