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

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | undefined;
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
@Injectable()
export class StorageService {
  private readonly internal: S3Client;
  private readonly signer: S3Client;
  readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
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

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
