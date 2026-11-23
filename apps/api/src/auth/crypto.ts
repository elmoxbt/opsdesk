import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. Used for refresh tokens and invitation links. */
export const generateOpaqueToken = (): string => randomBytes(32).toString("base64url");

/**
 * Opaque tokens are stored as SHA-256 hashes: a DB leak doesn't hand out live
 * sessions. A fast hash is fine here (unlike passwords) because the input has
 * 256 bits of entropy, so brute force is not a concern.
 */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
