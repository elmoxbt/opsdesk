import { Injectable } from "@nestjs/common";
import type { Prisma } from "@opsdesk/db";
import type { AuthUser, LoginInput } from "@opsdesk/shared";
import { AppException } from "../common/app-exception";
import { PrismaService } from "../prisma/prisma.service";
import type { ClientMeta, RequestUser } from "./auth.types";
import { PasswordService } from "./password.service";
import { type IssuedTokens, TokenService } from "./token.service";

export const authUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  organization: {
    select: { id: true, name: true, slug: true, timezone: true, currency: true, brandColor: true },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async login(input: LoginInput, meta: ClientMeta): Promise<{ user: AuthUser; tokens: IssuedTokens }> {
    const record = await this.prisma.unscoped.user.findUnique({
      where: { email: input.email },
      select: { ...authUserSelect, organizationId: true, passwordHash: true, isActive: true },
    });
    // Same error and (roughly) same timing for unknown email vs wrong password,
    // so the endpoint can't be used to discover which emails have accounts.
    const ok = await this.passwords.verify(input.password, record?.passwordHash);
    if (!record || !ok || !record.isActive) {
      throw new AppException("UNAUTHENTICATED", "Invalid email or password");
    }
    await this.prisma.unscoped.user.update({ where: { id: record.id }, data: { lastLoginAt: new Date() } });
    const user: AuthUser = {
      id: record.id,
      email: record.email,
      name: record.name,
      role: record.role,
      organization: record.organization,
    };
    return { user, tokens: await this.tokens.issue(toRequestUser(user), meta) };
  }

  async refresh(
    refreshToken: string | undefined,
    meta: ClientMeta,
  ): Promise<{ user: AuthUser; tokens: IssuedTokens }> {
    if (!refreshToken) throw new AppException("UNAUTHENTICATED", "Invalid or expired session");
    const { user, tokens } = await this.tokens.rotate(refreshToken, meta);
    return { user: await this.getAuthUser(user.id), tokens };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revoke(refreshToken);
  }

  async getAuthUser(userId: string): Promise<AuthUser> {
    return this.prisma.unscoped.user.findUniqueOrThrow({ where: { id: userId }, select: authUserSelect });
  }
}

export function toRequestUser(user: AuthUser): RequestUser {
  return { id: user.id, organizationId: user.organization.id, role: user.role };
}
