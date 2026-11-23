import { createHash, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { API_KEY_PATTERN } from "@opsdesk/shared";
import { AppException } from "../common/app-exception";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "./auth.types";

export const hashApiKeySecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

const TOUCH_EVERY_MS = 60_000;

/**
 * Resolves `Authorization: Bearer opsk_<prefix>_<secret>`. The prefix is an
 * indexed lookup (no scanning every key); the secret is compared as a SHA-256
 * hash in constant time. API keys are long random strings, so a fast hash is
 * right here (bcrypt is for low-entropy human passwords and would make every
 * API call slow). Lives in auth/ because it runs before a tenant is known.
 */
@Injectable()
export class ApiKeyAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(raw: string): Promise<RequestUser> {
    const m = API_KEY_PATTERN.exec(raw);
    const invalid = () => new AppException("UNAUTHENTICATED", "Invalid API key");
    if (!m) throw invalid();
    const [, prefix, secret] = m as unknown as [string, string, string];
    const key = await this.prisma.unscoped.apiKey.findUnique({ where: { prefix } });
    if (!key) throw invalid();
    const given = Buffer.from(hashApiKeySecret(secret), "hex");
    const stored = Buffer.from(key.keyHash, "hex");
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) throw invalid();
    if (key.revokedAt) throw new AppException("UNAUTHENTICATED", "This API key was revoked");
    if (key.expiresAt && key.expiresAt < new Date())
      throw new AppException("UNAUTHENTICATED", "This API key has expired");

    // "Last used" for the settings page, without a write on every request.
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_EVERY_MS)
      void this.prisma.unscoped.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);

    return {
      id: key.id,
      organizationId: key.organizationId,
      role: "DISPATCHER",
      apiKey: { id: key.id, name: key.name, scopes: key.scopes },
    };
  }
}
