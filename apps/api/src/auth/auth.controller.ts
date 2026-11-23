import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type AuthUser, type LoginInput, loginSchema } from "@opsdesk/shared";
import type { Request, Response } from "express";
import { ApiZodBody, CurrentUser, Public } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ENV, type Env } from "../config/env";
import { AuthService } from "./auth.service";
import type { ClientMeta, RequestUser } from "./auth.types";
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "./cookies";
import { RateLimit } from "../common/rate-limit";

export const clientMeta = (req: Request): ClientMeta => ({ userAgent: req.header("user-agent"), ip: req.ip });
const refreshCookie = (req: Request): string | undefined =>
  (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // No public signup: each deployment serves one business, whose owner is
  // created by `bootstrap` from config/client.config.ts. Everyone else is invited.

  @Public()
  @Post("login")
  // Brute-force brake: 10 attempts per IP per 5 minutes.
  @RateLimit({ limit: 10, windowSec: 300, by: "ip" })
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser }> {
    const { user, tokens } = await this.auth.login(body, clientMeta(req));
    setAuthCookies(res, this.env, tokens);
    return { user };
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Rotate the refresh-token cookie and issue a new access token" })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ user: AuthUser }> {
    try {
      const { user, tokens } = await this.auth.refresh(refreshCookie(req), clientMeta(req));
      setAuthCookies(res, this.env, tokens);
      return { user };
    } catch (e) {
      clearAuthCookies(res, this.env);
      throw e;
    }
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(refreshCookie(req));
    clearAuthCookies(res, this.env);
  }

  @Get("me")
  @ApiCookieAuth()
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.getAuthUser(user.id);
  }
}
