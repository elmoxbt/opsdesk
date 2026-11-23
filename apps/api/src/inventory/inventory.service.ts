import { Injectable } from "@nestjs/common";
import { currentOrganizationId, type InventoryItem, type Prisma } from "@opsdesk/db";
import type { InventoryItemData, InventoryItemDto, InventoryListQuery, Paginated } from "@opsdesk/shared";
import { auditDiff, snapshot } from "../audit/audit-diff";
import { AuditService } from "../audit/audit.service";
import { StockAlertService } from "./stock-alert.service";
import { AppException } from "../common/app-exception";
import { iso, pageArgs, rethrowUnique } from "../common/mapping";
import { PrismaService } from "../prisma/prisma.service";

const AUDITED = ["name", "sku", "quantity", "reorderThreshold", "unitCostMinor"] as const;
const DUPLICATE = "Another item already uses this SKU";

export const toInventoryItemDto = (i: InventoryItem): InventoryItemDto => ({
  id: i.id,
  name: i.name,
  sku: i.sku,
  quantity: i.quantity,
  reorderThreshold: i.reorderThreshold,
  unitCostMinor: i.unitCostMinor,
  lowStock: i.quantity <= i.reorderThreshold,
  createdAt: iso(i.createdAt),
});

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stockAlerts: StockAlertService,
  ) {}

  async list(q: InventoryListQuery): Promise<Paginated<InventoryItemDto>> {
    const items = this.prisma.db.inventoryItem;
    const where: Prisma.InventoryItemWhereInput = {
      ...(q.q && {
        OR: [
          { name: { contains: q.q, mode: "insensitive" } },
          { sku: { contains: q.q, mode: "insensitive" } },
        ],
      }),
      // Column-to-column comparison (quantity <= reorderThreshold) via Prisma field references.
      ...(q.lowStock && { quantity: { lte: items.fields.reorderThreshold } }),
    };
    const [rows, total] = await Promise.all([
      items.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], ...pageArgs(q) }),
      items.count({ where }),
    ]);
    return { items: rows.map(toInventoryItemDto), page: q.page, pageSize: q.pageSize, total };
  }

  async create(data: InventoryItemData): Promise<InventoryItemDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const item = await tx.inventoryItem.create({
          data: { ...data, organizationId: currentOrganizationId() },
        });
        await this.audit.record(
          {
            action: "inventory.created",
            entityType: "InventoryItem",
            entityId: item.id,
            after: snapshot(item, AUDITED),
          },
          tx,
        );
        return toInventoryItemDto(item);
      });
    } catch (e) {
      rethrowUnique(e, "sku", DUPLICATE);
    }
  }

  /** Full replace, including quantity: this is how a stocktake corrects counts. */
  async update(id: string, data: InventoryItemData): Promise<InventoryItemDto> {
    try {
      const dto = await this.prisma.db.$transaction(async (tx) => {
        const before = await tx.inventoryItem.findUnique({ where: { id } });
        if (!before) throw new AppException("NOT_FOUND", "Item not found");
        const after = await tx.inventoryItem.update({ where: { id }, data });
        const diff = auditDiff(before, after, AUDITED);
        if (diff)
          await this.audit.record(
            { action: "inventory.updated", entityType: "InventoryItem", entityId: id, ...diff },
            tx,
          );
        return toInventoryItemDto(after);
      });
      // A stocktake can push it below the threshold (alert) or restock it (re-arm the alert).
      await this.stockAlerts.check(id);
      return dto;
    } catch (e) {
      rethrowUnique(e, "sku", DUPLICATE);
    }
  }

  remove(id: string): Promise<void> {
    return this.prisma.db.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({
        where: { id },
        include: { _count: { select: { jobParts: true } } },
      });
      if (!item) throw new AppException("NOT_FOUND", "Item not found");
      if (item._count.jobParts > 0) {
        throw new AppException(
          "CONFLICT",
          "This item was used on jobs and can't be deleted. Set its quantity to 0 instead.",
        );
      }
      await tx.inventoryItem.delete({ where: { id } });
      await this.audit.record(
        {
          action: "inventory.deleted",
          entityType: "InventoryItem",
          entityId: id,
          before: snapshot(item, AUDITED),
        },
        tx,
      );
    });
  }
}
