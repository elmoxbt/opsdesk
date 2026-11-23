import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { RateLimit } from "../common/rate-limit";
import {
  type AcceptInvitationInput,
  acceptInvitationSchema,
  type AuthUser,
  type CreateInvitationInput,
  createInvitationSchema,
} from "@opsdesk/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import { clientMeta } from "../auth/auth.controller";
import type { RequestUser } from "../auth/auth.types";
import { setAuthCookies } from "../auth/cookies";
import { ApiZodBody, CurrentUser, Public, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ENV, type Env } from "../config/env";
import { type InvitationView, InvitationsService } from "./invitations.service";

const tokenQuerySchema = z.object({ token: z.string().min(20).max(200) });

@ApiTags("invitations")
@Controller("invitations")
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @Roles("OWNER", "DISPATCHER")
  @ApiCookieAuth()
  @ApiZodBody(createInvitationSchema)
  create(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationInput,
  ): Promise<InvitationView> {
    return this.invitations.create(actor, body);
  }

  @Get()
  @Roles("OWNER", "DISPATCHER")
  @ApiCookieAuth()
  list(): Promise<InvitationView[]> {
    return this.invitations.listPending();
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER", "DISPATCHER")
  @ApiCookieAuth()
  revoke(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.invitations.revoke(id);
  }

  @Public()
  @Get("lookup")
  lookup(@Query(new ZodValidationPipe(tokenQuerySchema)) q: z.infer<typeof tokenQuerySchema>) {
    return this.invitations.lookup(q.token);
  }

  @Public()
  @Post("accept")
  @RateLimit({ limit: 10, windowSec: 300, by: "ip" })
  @ApiZodBody(acceptInvitationSchema)
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser }> {
    const { user, tokens } = await this.invitations.accept(body, clientMeta(req));
    setAuthCookies(res, this.env, tokens);
    return { user };
  }
}
