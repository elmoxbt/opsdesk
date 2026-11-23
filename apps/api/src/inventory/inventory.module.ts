import { Module } from "@nestjs/common";
import { JobsModule } from "../jobs/jobs.module";
import { InventoryController, JobPartsController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

/** `inventory` feature: stock items and parts used on jobs. */
@Module({
  imports: [JobsModule],
  controllers: [InventoryController, JobPartsController],
  providers: [InventoryService],
})
export class InventoryModule {}
