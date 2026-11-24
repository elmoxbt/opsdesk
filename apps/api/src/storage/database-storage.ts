import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";
import type { ObjectHead, StorageDriver } from "./storage.service";

/** Vercel functions accept request bodies up to 4.5 MB; photos are compressed on the device well below that. */
export const MAX_DB_OBJECT_BYTES = 4_400_000;

export interface SignedRequest {
  method: "PUT" | "GET";
  key: string;
  contentType: string;
  expires: number;
  download: string;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
export const decodeKey = (k: string) => Buffer.from(k, "base64url").toString("utf8");

/**
 * Objects in Postgres, reached through HMAC-signed, expiring URLs on our own
 * API: the same model as presigned S3 URLs (the browser gets a URL valid for
 * one object, one method and a few minutes; it never holds credentials), for
 * deployments without S3, such as the serverless demo. Fine for demo volumes;
 * real clients use S3/MinIO.
 */
export class DatabaseStorageDriver implements StorageDriver {
  private readonly secret: Buffer;
  private readonly base: string;

  constructor(
    env: Env,
    private readonly prisma: PrismaService,
  ) {
    this.secret = createHash("sha256")
      .update(`storage-url:${env.DATA_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET}`)
      .digest();
    this.base = `${env.APP_URL.replace(/\/$/, "")}/api/storage/o`;
  }

  sign(r: SignedRequest): string {
    return createHmac("sha256", this.secret)
      .update([r.method, r.key, r.contentType, r.expires, r.download].join("\n"))
      .digest("base64url");
  }

  /** Constant-time check of a signature, plus expiry. */
  verify(r: SignedRequest, sig: string): boolean {
    if (!Number.isFinite(r.expires) || r.expires < Math.floor(Date.now() / 1000)) return false;
    const want = Buffer.from(this.sign(r));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private url(r: SignedRequest): string {
    const q = new URLSearchParams({
      m: r.method,
      ct: r.contentType,
      exp: String(r.expires),
      sig: this.sign(r),
    });
    if (r.download) q.set("dl", r.download);
    return `${this.base}/${b64(r.key)}?${q.toString()}`;
  }

  async presignPut(key: string, contentType: string, expiresInSeconds = 300): Promise<string> {
    return this.url({
      method: "PUT",
      key,
      contentType,
      expires: Math.floor(Date.now() / 1000) + expiresInSeconds,
      download: "",
    });
  }

  async presignGet(key: string, expiresInSeconds = 900, downloadName?: string): Promise<string> {
    return this.url({
      method: "GET",
      key,
      contentType: "",
      expires: Math.floor(Date.now() / 1000) + expiresInSeconds,
      download: downloadName ? downloadName.replace(/[^\w.-]/g, "_") : "",
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.prisma.db.storedObject.upsert({
      where: { key },
      create: { key, contentType, sizeBytes: body.length, data: body },
      update: { contentType, sizeBytes: body.length, data: body },
    });
  }

  async head(key: string): Promise<ObjectHead | null> {
    const o = await this.prisma.db.storedObject.findUnique({
      where: { key },
      select: { sizeBytes: true, contentType: true },
    });
    return o ? { sizeBytes: o.sizeBytes, contentType: o.contentType } : null;
  }

  async read(key: string): Promise<{ contentType: string; data: Buffer } | null> {
    const o = await this.prisma.db.storedObject.findUnique({
      where: { key },
      select: { contentType: true, data: true },
    });
    return o ? { contentType: o.contentType, data: Buffer.from(o.data) } : null;
  }

  async delete(key: string): Promise<void> {
    await this.prisma.db.storedObject.deleteMany({ where: { key } });
  }
}
