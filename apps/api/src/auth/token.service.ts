import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ROLES } from "@opsdesk/shared";
import { z } from "zod";
import { AppException } from "../common/app-exception";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { ClientMeta, RequestUser } from "./auth.types";
import { generateOpaqueToken, hashToken } from "./crypto";

const accessPayloadSchema = z.object({
  sub: z.uuid(),
  org: z.uuid(),
  role: z.enum(ROLES),
});

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Access tokens: short-lived (15 min) stateless JWTs.
 * Refresh tokens: long-lived opaque random strings, stored hashed, rotated on
 * every use. All tokens from one login form a "family"; presenting an already
 * rotated token means it was stolen (or replayed), so the whole family is revoked.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async issue(user: RequestUser, meta: ClientMeta, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const refreshToken = generateOpaqueToken();
    await this.prisma.unscoped.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: this.refreshExpiry(),
        userAgent: meta.userAgent?.slice(0, 255),
        ip: meta.ip,
      },
    });
    return { accessToken: await this.signAccess(user), refreshToken };
  }

  async verifyAccess(token: string): Promise<{ userId: string }> {
    try {
      const payload = accessPayloadSchema.parse(await this.jwt.verifyAsync(token));
      return { userId: payload.sub };
    } catch {
      throw new AppException("UNAUTHENTICATED", "Invalid or expired session");
    }
  }

  /** Exchanges a refresh token for a new pair. Returns the user it belongs to. */
  async rotate(refreshToken: string, meta: ClientMeta): Promise<{ user: RequestUser; tokens: IssuedTokens }> {
    const invalid = new AppException("UNAUTHENTICATED", "Invalid or expired session");
    const existing = await this.prisma.unscoped.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { select: { id: true, organizationId: true, role: true, isActive: true } } },
    });
    if (!existing) throw invalid;

    if (existing.revokedAt) {
      // Reuse of a rotated/revoked token: assume theft, kill every session in the family.
      await this.revokeFamily(existing.familyId);
      throw invalid;
    }
    if (existing.expiresAt <= new Date() || !existing.user.isActive) throw invalid;

    const user: RequestUser = {
      id: existing.user.id,
      organizationId: existing.user.organizationId,
      role: existing.user.role,
    };
    const newRefresh = generateOpaqueToken();

    await this.prisma.unscoped.$transaction(async (tx) => {
      // Conditional update makes rotation race-safe: of two concurrent refreshes
      // with the same token, exactly one wins; the other sees count=0.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count === 0) throw invalid;
      const next = await tx.refreshToken.create({
        data: {
          userId: user.id,
          familyId: existing.familyId,
          tokenHash: hashToken(newRefresh),
          expiresAt: this.refreshExpiry(),
          userAgent: meta.userAgent?.slice(0, 255),
          ip: meta.ip,
        },
      });
      await tx.refreshToken.update({ where: { id: existing.id }, data: { replacedById: next.id } });
    });

    return { user, tokens: { accessToken: await this.signAccess(user), refreshToken: newRefresh } };
  }

  /** Logout: revoke the family of the presented token (this device's session). */
  async revoke(refreshToken: string): Promise<void> {
    const existing = await this.prisma.unscoped.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      select: { familyId: true },
    });
    if (existing) await this.revokeFamily(existing.familyId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.unscoped.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.unscoped.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private signAccess(user: RequestUser): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, org: user.organizationId, role: user.role },
      { expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    );
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}
