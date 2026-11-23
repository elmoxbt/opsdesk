import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@opsdesk/shared";
import type { Request } from "express";
import { AppException } from "../common/app-exception";
import { ROLES_KEY } from "../common/decorators";

/** Runs after AuthGuard. Routes without @Roles() are open to any signed-in user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user || !required.includes(user.role)) {
      throw new AppException("FORBIDDEN", "You do not have permission to perform this action");
    }
    return true;
  }
}
