import { Inject, Injectable } from "@nestjs/common";
import { Prisma, tenantContext } from "@opsdesk/db";
import {
  type AcceptInvitationInput,
  type AuthUser,
  type CreateInvitationInput,
  INVITABLE_ROLES,
  type InvitationDto,
  INVITATION_TTL_HOURS,
  type Role,
} from "@opsdesk/shared";
import { AuditService } from "../audit/audit.service";
import { authUserSelect, toRequestUser } from "../auth/auth.service";
import type { ClientMeta, RequestUser } from "../auth/auth.types";
import { generateOpaqueToken, hashToken } from "../auth/crypto";
import { PasswordService } from "../auth/password.service";
import { type IssuedTokens, TokenService } from "../auth/token.service";
import { AppException } from "../common/app-exception";
import { iso } from "../common/mapping";
import { ENV, type Env } from "../config/env";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/mail.provider";
import { PrismaService } from "../prisma/prisma.service";

export type InvitationView = InvitationDto;

const invitationSelect = { id: true, email: true, role: true, expiresAt: true, createdAt: true } as const;
const toInvitationDto = (i: {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}): InvitationDto => ({
  ...i,
  expiresAt: iso(i.expiresAt),
  createdAt: iso(i.createdAt),
});

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(actor: RequestUser, input: CreateInvitationInput): Promise<InvitationView> {
    if (!INVITABLE_ROLES[actor.role].includes(input.role)) {
      throw new AppException(
        "FORBIDDEN",
        `A ${actor.role.toLowerCase()} cannot invite a ${input.role.toLowerCase()}`,
      );
    }
    // Emails are globally unique, so this check must look across tenants. We only
    // read a boolean, never another tenant's data.
    const taken = await this.prisma.unscoped.user.count({ where: { email: input.email } });
    if (taken)
      throw new AppException("CONFLICT", "That email already has an account", { email: ["Already in use"] });

    const token = generateOpaqueToken();
    const invitation = await this.prisma.db.$transaction(async (tx) => {
      // Re-inviting replaces any pending invite, so only the newest link works.
      await tx.invitation.updateMany({
        where: { email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          organizationId: actor.organizationId,
          email: input.email,
          role: input.role,
          invitedById: actor.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000),
        },
        select: invitationSelect,
      });
      await this.audit.record(
        {
          action: "invitation.created",
          entityType: "Invitation",
          entityId: created.id,
          after: { email: created.email, role: created.role },
        },
        tx,
      );
      return toInvitationDto(created);
    });

    const org = await this.prisma.unscoped.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { name: true },
    });
    const link = `${this.env.WEB_ORIGIN[0]}/accept-invite?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      to: input.email,
      subject: `You're invited to join ${org.name} on OpsDesk`,
      text: `You've been invited to join ${org.name} as a ${input.role.toLowerCase()}.\n\nAccept: ${link}\n\nThis link expires in ${INVITATION_TTL_HOURS} hours.`,
    });
    return invitation;
  }

  async listPending(): Promise<InvitationView[]> {
    const rows = await this.prisma.db.invitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: invitationSelect,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toInvitationDto);
  }

  async revoke(id: string): Promise<void> {
    const res = await this.prisma.db.invitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw new AppException("NOT_FOUND", "Invitation not found");
    await this.audit.record({ action: "invitation.revoked", entityType: "Invitation", entityId: id });
  }

  /** Public: lets the accept page show "Join Acme as a technician" before signup. */
  async lookup(token: string): Promise<{ email: string; role: Role; organizationName: string }> {
    const inv = await this.findUsable(token);
    return { email: inv.email, role: inv.role, organizationName: inv.organization.name };
  }

  async accept(
    input: AcceptInvitationInput,
    meta: ClientMeta,
  ): Promise<{ user: AuthUser; tokens: IssuedTokens }> {
    const inv = await this.findUsable(input.token);
    const passwordHash = await this.passwords.hash(input.password);

    try {
      const user = await this.prisma.unscoped.$transaction(async (tx) => {
        // Claim the invite atomically: two simultaneous accepts can't both succeed.
        const claimed = await tx.invitation.updateMany({
          where: { id: inv.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count === 0) throw new AppException("CONFLICT", "This invitation has already been used");
        const created = await tx.user.create({
          data: {
            organizationId: inv.organizationId,
            email: inv.email,
            name: input.name,
            role: inv.role,
            passwordHash,
            lastLoginAt: new Date(),
          },
          select: authUserSelect,
        });
        await this.audit.record(
          {
            organizationId: inv.organizationId,
            actorId: created.id,
            action: "invitation.accepted",
            entityType: "User",
            entityId: created.id,
            after: { email: created.email, role: created.role },
          },
          tx,
        );
        return created;
      });
      tenantContext.set({ organizationId: user.organization.id, userId: user.id, role: user.role });
      return { user, tokens: await this.tokens.issue(toRequestUser(user), meta) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new AppException("CONFLICT", "That email already has an account");
      }
      throw e;
    }
  }

  private async findUsable(token: string) {
    const inv = await this.prisma.unscoped.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: { select: { name: true } } },
    });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt <= new Date()) {
      throw new AppException("NOT_FOUND", "This invitation is invalid or has expired");
    }
    return inv;
  }
}
