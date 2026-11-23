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
  type CustomerData,
  type CustomerDto,
  customerInputSchema,
  type CustomerListQuery,
  customerListQuerySchema,
  type Paginated,
} from "@opsdesk/shared";
import { ApiZodBody, ApiZodQuery, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CustomersService } from "./customers.service";

/** Technicians reach customer details only through their assigned jobs. */
@ApiTags("customers")
@ApiCookieAuth()
@Roles("OWNER", "DISPATCHER")
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiKeyScope("customers:read")
  @ApiZodQuery(customerListQuerySchema)
  list(
    @Query(new ZodValidationPipe(customerListQuerySchema)) q: CustomerListQuery,
  ): Promise<Paginated<CustomerDto>> {
    return this.customers.list(q);
  }

  @Get(":id")
  @ApiKeyScope("customers:read")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<CustomerDto> {
    return this.customers.get(id);
  }

  @Post()
  @ApiKeyScope("customers:write")
  @ApiZodBody(customerInputSchema)
  create(@Body(new ZodValidationPipe(customerInputSchema)) body: CustomerData): Promise<CustomerDto> {
    return this.customers.create(body);
  }

  @Put(":id")
  @ApiKeyScope("customers:write")
  @ApiZodBody(customerInputSchema)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(customerInputSchema)) body: CustomerData,
  ): Promise<CustomerDto> {
    return this.customers.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.customers.remove(id);
  }
}
