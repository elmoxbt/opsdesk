import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  type Paginated,
  type UserListQuery,
  userListQuerySchema,
  type UpdateUserRoleInput,
  updateUserRoleSchema,
} from "@opsdesk/shared";
import type { RequestUser } from "../auth/auth.types";
import { ApiZodBody, ApiZodQuery, CurrentUser, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { type UserListItem, UsersService } from "./users.service";

@ApiTags("users")
@ApiCookieAuth()
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles("OWNER", "DISPATCHER")
  @ApiZodQuery(userListQuerySchema)
  list(
    @Query(new ZodValidationPipe(userListQuerySchema)) query: UserListQuery,
  ): Promise<Paginated<UserListItem>> {
    return this.users.list(query);
  }

  @Patch(":id/role")
  @Roles("OWNER")
  @ApiZodBody(updateUserRoleSchema)
  changeRole(
    @CurrentUser() actor: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserRoleSchema)) body: UpdateUserRoleInput,
  ): Promise<UserListItem> {
    return this.users.changeRole(actor.id, id, body.role);
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @Roles("OWNER")
  deactivate(
    @CurrentUser() actor: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<UserListItem> {
    return this.users.deactivate(actor.id, id);
  }
}
