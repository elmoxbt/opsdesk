import { Controller, Get, Query } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { NotificationDto } from "@opsdesk/shared";
import { z } from "zod";
import { ApiZodQuery, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { NotificationService } from "./notification.service";

const query = z.object({ entityType: z.enum(["Job", "Invoice", "InventoryItem"]), entityId: z.uuid() });

/** "Messages sent" on a job or invoice: what the customer was told, when, and whether it arrived. */
@ApiTags("notifications")
@ApiCookieAuth()
@Roles("OWNER", "DISPATCHER")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiZodQuery(query)
  list(@Query(new ZodValidationPipe(query)) q: z.infer<typeof query>): Promise<NotificationDto[]> {
    return this.notifications.listFor(q.entityType, q.entityId);
  }
}
