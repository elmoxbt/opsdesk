import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import { ApiBody, ApiQuery } from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import type { Role } from "@opsdesk/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestUser } from "../auth/auth.types";

export const IS_PUBLIC_KEY = "isPublic";
/** Opt a route out of the global auth guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
/** Restrict a route to the given roles. Without it, any authenticated user may call it. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw new Error("@CurrentUser() used on a route without authentication");
  return user;
});

const toOpenApi = (schema: z.ZodType): SchemaObject =>
  z.toJSONSchema(schema, { target: "openapi-3.0", io: "input", unrepresentable: "any" }) as SchemaObject;

/** Documents a request body in Swagger straight from the shared Zod schema. */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: toOpenApi(schema) });

export const ApiZodQuery = (schema: z.ZodObject) => {
  const decorators = Object.entries(schema.shape).map(([name, field]) =>
    ApiQuery({ name, required: false, schema: toOpenApi(field as z.ZodType) }),
  );
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    for (const d of decorators) d(target, key as string | symbol, descriptor as PropertyDescriptor);
  };
};
