import { Controller, Get, Query } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { type AnalyticsOverviewDto, type AnalyticsQuery, analyticsQuerySchema } from "@opsdesk/shared";
import { ApiZodQuery, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AnalyticsService } from "./analytics.service";

/** `analytics` feature. Owners only: revenue and utilisation are business-owner information. */
@ApiTags("analytics")
@ApiCookieAuth()
@Roles("OWNER")
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** `from`/`to` are calendar dates in the business's time zone, inclusive (max 366 days). */
  @Get("overview")
  @ApiZodQuery(analyticsQuerySchema)
  overview(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) q: AnalyticsQuery,
  ): Promise<AnalyticsOverviewDto> {
    return this.analytics.overview(q);
  }
}
