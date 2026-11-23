import { Injectable } from "@nestjs/common";
import { type ActorType, type Prisma, tenantContext } from "@opsdesk/db";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  /** Defaults to the current request's user. */
  actorId?: string;
  actorType?: ActorType;
  /** Defaults to the current tenant. Pass explicitly from pre-auth flows (signup). */
  organizationId?: string;
}

/** Minimal shape of anything that can write an audit row: the scoped client, the unscoped one, or a tx. */
export interface AuditWriter {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> };
}

/**
 * Append-only audit trail. Pass the transaction client when auditing inside a
 * transaction so the log entry commits (or rolls back) with the change itself.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, client: AuditWriter = this.prisma.db): Promise<void> {
    const ctx = tenantContext.get();
    const organizationId = entry.organizationId ?? ctx?.organizationId;
    if (!organizationId) throw new Error("AuditService.record: no organizationId");
    const actorId = entry.actorId ?? ctx?.userId;
    await client.auditLog.create({
      data: {
        organizationId,
        actorId,
        actorType: entry.actorType ?? (actorId ? "USER" : ctx?.apiKeyId ? "API_KEY" : "SYSTEM"),
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
      },
    });
  }
}
