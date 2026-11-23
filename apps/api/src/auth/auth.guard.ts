import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ClientConfig } from "@opsdesk/config";
import { tenantContext } from "@opsdesk/db";
import type { ApiScope } from "@opsdesk/shared";
import type { Request } from "express";
import { API_KEY_SCOPE } from "../common/api-key-scope";
import { AppException } from "../common/app-exception";
import { IS_PUBLIC_KEY } from "../common/decorators";
import { CLIENT_CONFIG } from "../config/config.module";
import { ApiKeyAuthService } from "./api-key-auth.service";
import { ACCESS_COOKIE } from "./cookies";
import { SessionService } from "./session.service";

/**
 * Global guard: every route requires authentication unless marked @Public().
 * Secure-by-default means a forgotten decorator fails closed, not open.
 *
 * Two kinds of caller:
 *  - people: session cookie (browsers) or Bearer access token (tests, scripts);
 *  - integrations: Bearer API key (`opsk_…`), only with the `publicApi`
 *    feature on, only on routes marked @ApiKeyScope, and only with that scope.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeyAuthService,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const bearer = bearerToken(req);
    if (bearer?.startsWith("opsk_")) {
      if (!this.config.features.publicApi)
        throw new AppException("UNAUTHENTICATED", "API keys are not enabled");
      const scope = this.reflector.getAllAndOverride<ApiScope | undefined>(API_KEY_SCOPE, targets);
      const caller = await this.apiKeys.resolve(bearer);
      if (!scope) throw new AppException("FORBIDDEN", "This endpoint isn't available to API keys");
      if (!caller.apiKey!.scopes.includes(scope))
        throw new AppException("FORBIDDEN", `This API key needs the "${scope}" permission`);
      req.user = caller;
      tenantContext.set({ organizationId: caller.organizationId, apiKeyId: caller.id, role: caller.role });
      return true;
    }

    const token = extractAccessToken(req);
    if (!token) throw new AppException("UNAUTHENTICATED", "Authentication required");
    const user = await this.sessions.resolve(token);
    req.user = user;
    // From here on, every tenant-scoped query in this request is pinned to this org.
    tenantContext.set({ organizationId: user.organizationId, userId: user.id, role: user.role });
    return true;
  }
}

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() || undefined : undefined;
}

/** Cookie for browsers; Bearer header for scripts, tests and API clients. */
export function extractAccessToken(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  return bearerToken(req);
}

export { ACCESS_COOKIE };
