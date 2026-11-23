import { Injectable } from "@nestjs/common";
import { AppException } from "../common/app-exception";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "./auth.types";
import { TokenService } from "./token.service";

/**
 * Turns an access token into a live user, for both HTTP (AuthGuard) and
 * WebSocket handshakes, so the two transports can't drift apart.
 * The user is re-read every time: role changes and deactivation apply immediately.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(accessToken: string): Promise<RequestUser> {
    const { userId } = await this.tokens.verifyAccess(accessToken);
    const user = await this.prisma.unscoped.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true, role: true, isActive: true },
    });
    if (!user?.isActive) throw new AppException("UNAUTHENTICATED", "Invalid or expired session");
    return { id: user.id, organizationId: user.organizationId, role: user.role };
  }

  /** Display name for realtime "who did this" labels. */
  async displayName(userId: string): Promise<string | null> {
    const u = await this.prisma.unscoped.user.findUnique({ where: { id: userId }, select: { name: true } });
    return u?.name ?? null;
  }
}
