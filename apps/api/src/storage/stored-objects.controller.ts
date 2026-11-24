import { Controller, Get, Inject, Param, Put, Query, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AppException } from "../common/app-exception";
import { Public } from "../common/decorators";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { DatabaseStorageDriver, decodeKey, MAX_DB_OBJECT_BYTES } from "./database-storage";

interface SignedQuery {
  m?: string;
  ct?: string;
  exp?: string;
  sig?: string;
  dl?: string;
}

/**
 * The signed-URL endpoints for STORAGE_DRIVER=database. Public (the signature
 * IS the authorisation, exactly like a presigned S3 URL), so the upload and
 * download URLs work from <img> tags and the technician app's fetch alike.
 * When the S3 driver is in use these routes answer 404.
 */
@ApiExcludeController()
@Public()
@Controller("storage/o")
export class StoredObjectsController {
  private readonly driver: DatabaseStorageDriver | null;

  constructor(@Inject(ENV) env: Env, prisma: PrismaService) {
    this.driver = env.STORAGE_DRIVER === "database" ? new DatabaseStorageDriver(env, prisma) : null;
  }

  @Put(":k")
  async upload(
    @Param("k") k: string,
    @Query() q: SignedQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const driver = this.require();
    const key = decodeKey(k);
    const contentType = req.header("content-type") ?? "";
    const ok =
      q.m === "PUT" &&
      q.ct === contentType &&
      driver.verify({ method: "PUT", key, contentType, expires: Number(q.exp), download: "" }, q.sig ?? "");
    // Same answer as S3 for a bad or expired signature.
    if (!ok) throw new AppException("FORBIDDEN", "Upload URL is invalid or has expired");
    const body = await readBody(req, MAX_DB_OBJECT_BYTES);
    if (!body)
      throw new AppException(
        "BAD_REQUEST",
        `Files must be ${Math.floor(MAX_DB_OBJECT_BYTES / 1_000_000)} MB or smaller`,
      );
    await driver.put(key, body, contentType);
    res.status(200).end();
  }

  @Get(":k")
  async download(@Param("k") k: string, @Query() q: SignedQuery, @Res() res: Response): Promise<void> {
    const driver = this.require();
    const key = decodeKey(k);
    const ok =
      q.m === "GET" &&
      driver.verify(
        { method: "GET", key, contentType: "", expires: Number(q.exp), download: q.dl ?? "" },
        q.sig ?? "",
      );
    if (!ok) throw new AppException("FORBIDDEN", "Link is invalid or has expired");
    const obj = await driver.read(key);
    if (!obj) throw new AppException("NOT_FOUND", "Not found");
    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("Content-Length", String(obj.data.length));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (q.dl) res.setHeader("Content-Disposition", `inline; filename="${q.dl}"`);
    res.end(obj.data);
  }

  private require(): DatabaseStorageDriver {
    if (!this.driver) throw new AppException("NOT_FOUND", "Not found");
    return this.driver;
  }
}

/** Reads a raw request body (image bytes aren't parsed by the JSON parser), refusing anything over `limit`. */
function readBody(req: Request, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) tooBig = true;
      else chunks.push(c);
    });
    req.on("end", () => resolve(tooBig ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
