import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  type AddPartInput,
  addPartSchema,
  type InventoryItemData,
  type InventoryItemDto,
  inventoryItemInputSchema,
  type InventoryListQuery,
  inventoryListQuerySchema,
  type JobPartDto,
  type Paginated,
} from "@opsdesk/shared";
import type { RequestUser } from "../auth/auth.types";
import { ApiZodBody, ApiZodQuery, CurrentUser, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JobFieldService } from "../jobs/job-field.service";
import { InventoryService } from "./inventory.service";

@ApiTags("inventory")
@ApiCookieAuth()
@Controller("inventory-items")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** Everyone can read (technicians pick parts from it). */
  @Get()
  @ApiZodQuery(inventoryListQuerySchema)
  list(
    @Query(new ZodValidationPipe(inventoryListQuerySchema)) q: InventoryListQuery,
  ): Promise<Paginated<InventoryItemDto>> {
    return this.inventory.list(q);
  }

  @Post()
  @Roles("OWNER", "DISPATCHER")
  @ApiZodBody(inventoryItemInputSchema)
  create(
    @Body(new ZodValidationPipe(inventoryItemInputSchema)) body: InventoryItemData,
  ): Promise<InventoryItemDto> {
    return this.inventory.create(body);
  }

  @Put(":id")
  @Roles("OWNER", "DISPATCHER")
  @ApiZodBody(inventoryItemInputSchema)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(inventoryItemInputSchema)) body: InventoryItemData,
  ): Promise<InventoryItemDto> {
    return this.inventory.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER")
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.inventory.remove(id);
  }
}

/** Parts used on a job: part of the `inventory` feature, so it lives (and switches off) with it. */
@ApiTags("inventory")
@ApiCookieAuth()
@Controller("jobs/:id/parts")
export class JobPartsController {
  constructor(private readonly field: JobFieldService) {}

  @Get()
  list(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser): Promise<JobPartDto[]> {
    return this.field.parts(id, actor);
  }

  /** Deducts stock atomically; `id` is device-generated so replays are no-ops. */
  @Post()
  @ApiZodBody(addPartSchema)
  add(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addPartSchema)) body: AddPartInput & { quantity: number },
    @CurrentUser() actor: RequestUser,
  ): Promise<JobPartDto[]> {
    return this.field.addPart(id, body, actor);
  }

  @Delete(":partId")
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("partId", ParseUUIDPipe) partId: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<JobPartDto[]> {
    return this.field.removePart(id, partId, actor);
  }
}
