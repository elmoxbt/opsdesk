import { Controller, Get, Headers, Inject } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { timingSafeEqual } from "node:crypto";
import { AppException } from "../common/app-exception";
import { Public } from "../common/decorators";
import { ENV, type Env } from "../config/env";
import { RemindersService } from "./reminders.service";

/**
 * Scheduled work as an HTTP trigger, for hosts without a long-running worker
 * (Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`). With the
 * BullMQ worker, the same job runs from Redis's scheduler instead. Safe to call
 * any number of times: the reminder rules live in the data.
 */
@ApiExcludeController()
@Public()
@Controller("cron")
export class CronController {
  constructor(
    private readonly reminders: RemindersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get("overdue-reminders")
  async overdueReminders(@Headers("authorization") auth?: string): Promise<{ sent: number }> {
    const secret = this.env.CRON_SECRET;
    if (!secret) throw new AppException("NOT_FOUND", "Not found");
    const given = Buffer.from(auth ?? "");
    const want = Buffer.from(`Bearer ${secret}`);
    if (given.length !== want.length || !timingSafeEqual(given, want))
      throw new AppException("UNAUTHENTICATED", "Invalid cron secret");
    return { sent: await this.reminders.runAll() };
  }
}
