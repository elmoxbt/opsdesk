import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV, type Env } from "../config/env";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Low-stock alerts: ONE email to the office each time an item dips to or below
 * its reorder level, not one per part used. `lowStockAlertedAt` is the latch:
 * set (compare-and-swap, so two technicians using the last valves alert once)
 * when the alert goes out, cleared when stock is back above the threshold.
 *
 * Call after the stock-changing transaction commits. Provided by the core jobs
 * module because parts are recorded there; only does anything when items exist.
 */
@Injectable()
export class StockAlertService {
  private readonly logger = new Logger(StockAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async check(itemId: string): Promise<void> {
    try {
      const item = await this.prisma.db.inventoryItem.findUnique({ where: { id: itemId } });
      if (!item) return;
      const low = item.quantity <= item.reorderThreshold;
      if (!low) {
        if (item.lowStockAlertedAt)
          await this.prisma.db.inventoryItem.updateMany({
            where: { id: itemId, lowStockAlertedAt: { not: null } },
            data: { lowStockAlertedAt: null },
          });
        return;
      }
      if (item.lowStockAlertedAt) return;
      const now = new Date();
      const latched = await this.prisma.db.inventoryItem.updateMany({
        where: { id: itemId, lowStockAlertedAt: null },
        data: { lowStockAlertedAt: now },
      });
      if (latched.count === 0) return;
      await this.notify.toManagers(
        "stock.low",
        {
          item: item.name,
          sku: item.sku,
          quantity: item.quantity,
          threshold: item.reorderThreshold,
          url: `${this.env.APP_URL.replace(/\/$/, "")}/inventory?low=1`,
        },
        {
          entity: { type: "InventoryItem", id: item.id },
          dedupeKey: `stock-low:${item.id}:${now.toISOString()}`,
        },
      );
    } catch (e) {
      // An alert must never fail the stock change that triggered it.
      this.logger.error(`stock alert for ${itemId} failed: ${String(e)}`);
    }
  }
}
