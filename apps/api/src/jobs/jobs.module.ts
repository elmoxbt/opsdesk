import { Module } from "@nestjs/common";
import { StockAlertService } from "../inventory/stock-alert.service";
import { JobFieldService } from "./job-field.service";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";

/**
 * Core jobs. JobFieldService (photos, completion, parts, checklist) is shared
 * domain logic; its HTTP endpoints belong to optional features and are mounted
 * by TechnicianAppModule / InventoryModule only when those are enabled.
 */
@Module({
  controllers: [JobsController],
  providers: [JobsService, JobFieldService, StockAlertService],
  exports: [JobsService, JobFieldService, StockAlertService],
})
export class JobsModule {}
