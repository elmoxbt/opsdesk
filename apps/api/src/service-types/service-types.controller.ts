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
import { ApiKeyScope } from "../common/api-key-scope";
import {
  type Paginated,
  type ServiceTypeData,
  type ServiceTypeDto,
  serviceTypeInputSchema,
  type ServiceTypeListQuery,
  serviceTypeListQuerySchema,
} from "@opsdesk/shared";
import { ApiZodBody, ApiZodQuery, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ServiceTypesService } from "./service-types.service";

@ApiTags("service-types")
@ApiCookieAuth()
@Controller("service-types")
export class ServiceTypesController {
  constructor(private readonly services: ServiceTypesService) {}

  /** Readable by everyone in the org (technicians see what they're doing). */
  @Get()
  @ApiKeyScope("jobs:read")
  @ApiZodQuery(serviceTypeListQuerySchema)
  list(
    @Query(new ZodValidationPipe(serviceTypeListQuerySchema)) q: ServiceTypeListQuery,
  ): Promise<Paginated<ServiceTypeDto>> {
    return this.services.list(q);
  }

  @Post()
  @Roles("OWNER")
  @ApiZodBody(serviceTypeInputSchema)
  create(
    @Body(new ZodValidationPipe(serviceTypeInputSchema)) body: ServiceTypeData,
  ): Promise<ServiceTypeDto> {
    return this.services.create(body);
  }

  @Put(":id")
  @Roles("OWNER")
  @ApiZodBody(serviceTypeInputSchema)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(serviceTypeInputSchema)) body: ServiceTypeData,
  ): Promise<ServiceTypeDto> {
    return this.services.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER")
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.services.remove(id);
  }
}
