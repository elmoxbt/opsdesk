import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import {
  checklistItemPatchSchema,
  type CompleteJobInput,
  completeJobSchema,
  type ConfirmPhotoInput,
  confirmPhotoSchema,
  type JobDto,
  type JobMediaDto,
  type UploadRequest,
  uploadRequestSchema,
  type UploadTicketDto,
} from "@opsdesk/shared";
import { z } from "zod";
import type { RequestUser } from "../auth/auth.types";
import { ApiZodBody, CurrentUser } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JobFieldService } from "./job-field.service";

const itemIdSchema = z.string().min(1).max(50);

/**
 * On-site work, used by the technician app (and visible to managers).
 * Visibility rules come from JobsService.findVisible: technicians only reach their own jobs.
 * Every write is replay-safe; clients also send Idempotency-Key.
 */
@ApiTags("field")
@ApiCookieAuth()
@ApiHeader({
  name: "Idempotency-Key",
  required: false,
  description: "Makes retries return the original response",
})
@Controller("jobs/:id")
export class JobFieldController {
  constructor(private readonly field: JobFieldService) {}

  /** Step 1 of a photo/signature upload: a presigned PUT URL, valid 5 minutes. */
  @Post("uploads")
  @ApiZodBody(uploadRequestSchema)
  createUpload(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(uploadRequestSchema)) body: UploadRequest,
    @CurrentUser() actor: RequestUser,
  ): Promise<UploadTicketDto> {
    return this.field.createUpload(id, body, actor);
  }

  /** Step 3: record an uploaded photo (verified with S3 first). */
  @Post("photos")
  @ApiZodBody(confirmPhotoSchema)
  confirmPhoto(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(confirmPhotoSchema)) body: ConfirmPhotoInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<JobMediaDto> {
    return this.field.confirmPhoto(id, body, actor);
  }

  @Delete("photos/:photoId")
  @HttpCode(204)
  deletePhoto(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("photoId", ParseUUIDPipe) photoId: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<void> {
    return this.field.deletePhoto(id, photoId, actor);
  }

  @Get("media")
  media(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser): Promise<JobMediaDto> {
    return this.field.media(id, actor);
  }

  /** IN_PROGRESS → COMPLETED with the customer's signature, in one transaction. */
  @Post("complete")
  @HttpCode(200)
  @ApiZodBody(completeJobSchema)
  complete(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(completeJobSchema)) body: CompleteJobInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<JobDto> {
    return this.field.complete(id, body, actor);
  }

  @Patch("checklist/:itemId")
  @ApiZodBody(checklistItemPatchSchema)
  setChecklistItem(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("itemId", new ZodValidationPipe(itemIdSchema)) itemId: string,
    @Body(new ZodValidationPipe(checklistItemPatchSchema)) body: { done: boolean },
    @CurrentUser() actor: RequestUser,
  ): Promise<JobDto> {
    return this.field.setChecklistItem(id, itemId, body.done, actor);
  }
}
