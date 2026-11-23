import { Injectable } from "@nestjs/common";
import { currentOrganizationId, type Customer, type Prisma } from "@opsdesk/db";
import {
  type CustomerData,
  type CustomerDto,
  type CustomerListQuery,
  type Paginated,
  phoneKey,
} from "@opsdesk/shared";
import { auditDiff, snapshot } from "../audit/audit-diff";
import { AuditService } from "../audit/audit.service";
import { AppException } from "../common/app-exception";
import { iso, pageArgs } from "../common/mapping";
import { PrismaService } from "../prisma/prisma.service";

const AUDITED = ["name", "phone", "email", "address", "notes"] as const;

export function toCustomerDto(c: Customer & { _count?: { jobs: number } }): CustomerDto {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: c.address,
    notes: c.notes,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
    ...(c._count ? { jobCount: c._count.jobs } : {}),
  };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: CustomerListQuery): Promise<Paginated<CustomerDto>> {
    const where: Prisma.CustomerWhereInput = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { phone: { contains: query.q } },
            { email: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {};
    const orderBy: Prisma.CustomerOrderByWithRelationInput =
      query.sort === "name" ? { name: "asc" } : { createdAt: "desc" };

    const [rows, total] = await Promise.all([
      this.prisma.db.customer.findMany({
        where,
        orderBy: [orderBy, { id: "asc" }], // id tiebreaker keeps pagination stable
        include: { _count: { select: { jobs: true } } },
        ...pageArgs(query),
      }),
      this.prisma.db.customer.count({ where }),
    ]);
    return { items: rows.map(toCustomerDto), page: query.page, pageSize: query.pageSize, total };
  }

  async get(id: string): Promise<CustomerDto> {
    const c = await this.prisma.db.customer.findUnique({
      where: { id },
      include: { _count: { select: { jobs: true } } },
    });
    if (!c) throw new AppException("NOT_FOUND", "Customer not found");
    return toCustomerDto(c);
  }

  create(data: CustomerData): Promise<CustomerDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const c = await tx.customer.create({
        data: { ...data, phoneKey: phoneKey(data.phone), organizationId: currentOrganizationId() },
      });
      await this.audit.record(
        { action: "customer.created", entityType: "Customer", entityId: c.id, after: snapshot(c, AUDITED) },
        tx,
      );
      return toCustomerDto(c);
    });
  }

  update(id: string, data: CustomerData): Promise<CustomerDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.customer.findUnique({ where: { id } });
      if (!before) throw new AppException("NOT_FOUND", "Customer not found");
      const after = await tx.customer.update({
        where: { id },
        data: { ...data, phoneKey: phoneKey(data.phone) },
      });
      const diff = auditDiff(before, after, AUDITED);
      if (diff)
        await this.audit.record(
          { action: "customer.updated", entityType: "Customer", entityId: id, ...diff },
          tx,
        );
      return toCustomerDto(after);
    });
  }

  remove(id: string): Promise<void> {
    return this.prisma.db.$transaction(async (tx) => {
      const c = await tx.customer.findUnique({
        where: { id },
        include: { _count: { select: { jobs: true } } },
      });
      if (!c) throw new AppException("NOT_FOUND", "Customer not found");
      if (c._count.jobs > 0) {
        throw new AppException(
          "CONFLICT",
          "This customer has jobs and can't be deleted. Their history must be kept.",
        );
      }
      await tx.customer.delete({ where: { id } });
      await this.audit.record(
        { action: "customer.deleted", entityType: "Customer", entityId: id, before: snapshot(c, AUDITED) },
        tx,
      );
    });
  }
}
