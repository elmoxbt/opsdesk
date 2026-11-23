import { Injectable } from "@nestjs/common";
import { currentOrganizationId, type Prisma, type ServiceType } from "@opsdesk/db";
import type { Paginated, ServiceTypeData, ServiceTypeDto, ServiceTypeListQuery } from "@opsdesk/shared";
import { auditDiff, snapshot } from "../audit/audit-diff";
import { AuditService } from "../audit/audit.service";
import { AppException } from "../common/app-exception";
import { iso, pageArgs, rethrowUnique } from "../common/mapping";
import { PrismaService } from "../prisma/prisma.service";

const AUDITED = ["name", "description", "defaultDurationMinutes", "defaultPriceMinor", "isActive"] as const;
const DUPLICATE = "A service with this name already exists";

export const toServiceTypeDto = (s: ServiceType): ServiceTypeDto => ({
  id: s.id,
  name: s.name,
  description: s.description,
  defaultDurationMinutes: s.defaultDurationMinutes,
  defaultPriceMinor: s.defaultPriceMinor,
  isActive: s.isActive,
  createdAt: iso(s.createdAt),
});

@Injectable()
export class ServiceTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ServiceTypeListQuery): Promise<Paginated<ServiceTypeDto>> {
    const where: Prisma.ServiceTypeWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.serviceType.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.db.serviceType.count({ where }),
    ]);
    return { items: rows.map(toServiceTypeDto), page: query.page, pageSize: query.pageSize, total };
  }

  async create(data: ServiceTypeData): Promise<ServiceTypeDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const s = await tx.serviceType.create({ data: { ...data, organizationId: currentOrganizationId() } });
        await this.audit.record(
          {
            action: "service_type.created",
            entityType: "ServiceType",
            entityId: s.id,
            after: snapshot(s, AUDITED),
          },
          tx,
        );
        return toServiceTypeDto(s);
      });
    } catch (e) {
      rethrowUnique(e, "name", DUPLICATE);
    }
  }

  async update(id: string, data: ServiceTypeData): Promise<ServiceTypeDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const before = await tx.serviceType.findUnique({ where: { id } });
        if (!before) throw new AppException("NOT_FOUND", "Service not found");
        const after = await tx.serviceType.update({ where: { id }, data });
        const diff = auditDiff(before, after, AUDITED);
        if (diff) {
          await this.audit.record(
            { action: "service_type.updated", entityType: "ServiceType", entityId: id, ...diff },
            tx,
          );
        }
        return toServiceTypeDto(after);
      });
    } catch (e) {
      rethrowUnique(e, "name", DUPLICATE);
    }
  }

  remove(id: string): Promise<void> {
    return this.prisma.db.$transaction(async (tx) => {
      const s = await tx.serviceType.findUnique({
        where: { id },
        include: { _count: { select: { jobs: true } } },
      });
      if (!s) throw new AppException("NOT_FOUND", "Service not found");
      if (s._count.jobs > 0) {
        throw new AppException(
          "CONFLICT",
          "This service is used by jobs. Deactivate it instead of deleting.",
        );
      }
      await tx.serviceType.delete({ where: { id } });
      await this.audit.record(
        {
          action: "service_type.deleted",
          entityType: "ServiceType",
          entityId: id,
          before: snapshot(s, AUDITED),
        },
        tx,
      );
    });
  }
}
