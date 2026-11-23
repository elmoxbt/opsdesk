import { Injectable } from "@nestjs/common";
import { currentOrganizationId, type Prisma } from "@opsdesk/db";
import type { Paginated, Role, UserDto, UserListQuery } from "@opsdesk/shared";
import { iso, isoOrNull } from "../common/mapping";
import { AuditService } from "../audit/audit.service";
import { TokenService } from "../auth/token.service";
import { AppException } from "../common/app-exception";
import { PrismaService } from "../prisma/prisma.service";
import { DomainEvents } from "../realtime/domain-events";

const userListSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatarUrl: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export type UserListItem = UserDto;

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const toUserDto = (u: UserRow): UserDto => ({
  ...u,
  lastLoginAt: isoOrNull(u.lastLoginAt),
  createdAt: iso(u.createdAt),
});

/**
 * Note what's absent: no `organizationId` anywhere. `prisma.db` scopes every
 * query to the caller's tenant, so another tenant's user id is just "not found".
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly events: DomainEvents,
  ) {}

  async list({ page, pageSize, role, active }: UserListQuery): Promise<Paginated<UserListItem>> {
    const where: Prisma.UserWhereInput = {
      ...(role && { role }),
      ...(active !== undefined && { isActive: active }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.user.findMany({
        where,
        select: userListSelect,
        orderBy: [{ role: "asc" }, { name: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.user.count({ where }),
    ]);
    return { items: rows.map(toUserDto), page, pageSize, total };
  }

  async changeRole(actorId: string, userId: string, role: Exclude<Role, "OWNER">): Promise<UserListItem> {
    if (actorId === userId) throw new AppException("FORBIDDEN", "You cannot change your own role");
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: userId }, select: userListSelect });
      if (!before) throw new AppException("NOT_FOUND", "User not found");
      if (before.role === "OWNER") throw new AppException("FORBIDDEN", "The owner's role cannot be changed");
      const after = await tx.user.update({ where: { id: userId }, data: { role }, select: userListSelect });
      await this.audit.record(
        {
          action: "user.role_changed",
          entityType: "User",
          entityId: userId,
          before: { role: before.role },
          after: { role },
        },
        tx,
      );
      return toUserDto(after);
    });
  }

  async deactivate(actorId: string, userId: string): Promise<UserListItem> {
    if (actorId === userId) throw new AppException("FORBIDDEN", "You cannot deactivate yourself");
    const user = await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: userId }, select: userListSelect });
      if (!before) throw new AppException("NOT_FOUND", "User not found");
      if (before.role === "OWNER") throw new AppException("FORBIDDEN", "The owner cannot be deactivated");
      const after = await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
        select: userListSelect,
      });
      await this.audit.record(
        {
          action: "user.deactivated",
          entityType: "User",
          entityId: userId,
          before: { isActive: true },
          after: { isActive: false },
        },
        tx,
      );
      return toUserDto(after);
    });
    // End their sessions now (refresh tokens + live sockets); the auth guard already
    // rejects inactive users on their next HTTP request.
    await this.tokens.revokeAllForUser(userId);
    this.events.publish({ type: "user.deactivated", organizationId: currentOrganizationId(), userId });
    return user;
  }
}
