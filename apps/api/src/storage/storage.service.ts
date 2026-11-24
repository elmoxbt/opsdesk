import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { DatabaseStorageDriver } from "./database-storage";
import { StoredObjectsController } from "./stored-objects.controller";

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | undefined;
}

/** What the app needs from object storage. Callers depend on StorageService, never on a driver. */
export interface StorageDriver {
  presignPut(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  presignGet(key: string, expiresInSeconds?: number, downloadName?: string): Promise<string>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  head(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
}

/**
 * Thin wrapper over S3. Uploads never pass through the API: the browser PUTs
 * straight to S3 with a presigned URL (fast, no API memory/bandwidth), then the
 * API verifies the object with HEAD before recording it.
 *
 * Two clients: one for server-side calls (HEAD/DELETE) on the internal
 * endpoint, one that SIGNS URLs for the host browsers can reach. The signature
 * covers the host, so it must be signed for the public one.
 */
export class S3StorageDriver implements StorageDriver {
  private readonly internal: S3Client;
  private readonly signer: S3Client;
  readonly bucket: string;

  constructor(env: Env) {
    const base = {
      region: env.S3_REGION,
      forcePathStyle: true, // MinIO and most S3-compatibles need path-style URLs
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    };
    this.internal = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
    this.bucket = env.S3_BUCKET;
  }

  /** The content type is part of the signature: the upload must use exactly this type. */
  presignPut(key: string, contentType: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      {
        expiresIn: expiresInSeconds,
      },
    );
  }

  /** `downloadName` makes the browser save it under a friendly name (e.g. INV-0042.pdf). */
  presignGet(key: string, expiresInSeconds = 900, downloadName?: string): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: downloadName
          ? `inline; filename="${downloadName.replace(/[^\w.-]/g, "_")}"`
          : undefined,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** Server-generated files (PDFs). User uploads never come through here. */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (e) {
      if (e instanceof NotFound || (e instanceof S3ServiceException && e.$metadata.httpStatusCode === 404))
        return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * Object storage for photos, signatures and PDFs. S3 (MinIO, AWS, R2) in a normal
 * deployment; Postgres-backed with signed URLs (DatabaseStorageDriver) for a
 * serverless demo that has no S3. Same contract either way: short-lived signed
 * URLs, so the browser never holds credentials and nothing is public.
 */
@Injectable()
export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver;

  constructor(@Inject(ENV) env: Env, prisma: PrismaService) {
    this.driver =
      env.STORAGE_DRIVER === "database" ? new DatabaseStorageDriver(env, prisma) : new S3StorageDriver(env);
  }

  presignPut(key: string, contentType: string, expiresInSeconds = 300): Promise<string> {
    return this.driver.presignPut(key, contentType, expiresInSeconds);
  }
  presignGet(key: string, expiresInSeconds = 900, downloadName?: string): Promise<string> {
    return this.driver.presignGet(key, expiresInSeconds, downloadName);
  }
  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.driver.put(key, body, contentType);
  }
  head(key: string): Promise<ObjectHead | null> {
    return this.driver.head(key);
  }
  delete(key: string): Promise<void> {
    return this.driver.delete(key);
  }
}

@Global()
@Module({ controllers: [StoredObjectsController], providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
