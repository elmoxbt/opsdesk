import { Controller, Get, Query } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { type AuditListQuery, auditListQuerySchema, type AuditLogDto, type Paginated } from "@opsdesk/shared";
import { ApiZodQuery, Roles } from "../common/decorators";
import { iso, pageArgs } from "../common/mapping";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("audit")
@ApiCookieAuth()
@Roles("OWNER", "DISPATCHER")
@Controller("audit-logs")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Powers the activity timeline on detail pages. Newest first. */
  @Get()
  @ApiZodQuery(auditListQuerySchema)
  async list(
    @Query(new ZodValidationPipe(auditListQuerySchema)) q: AuditListQuery,
  ): Promise<Paginated<AuditLogDto>> {
    const where = {
      ...(q.entityType && { entityType: q.entityType }),
      ...(q.entityId && { entityId: q.entityId }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(q),
      }),
      this.prisma.db.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actor: r.actor,
        actorType: r.actorType,
        before: r.before,
        after: r.after,
        createdAt: iso(r.createdAt),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }
}
