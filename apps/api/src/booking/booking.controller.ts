import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { tenantContext } from "@opsdesk/db";
import {
  availabilityQuerySchema,
  type AvailabilityDto,
  type BookingConfirmationDto,
  type BookingData,
  bookingInputSchema,
  type BookingPortalDto,
  type BookingStatusDto,
} from "@opsdesk/shared";
import type { z } from "zod";
import { AppException } from "../common/app-exception";
import { ApiZodBody, ApiZodQuery, Public } from "../common/decorators";
import { RateLimit } from "../common/rate-limit";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireFeature } from "../features/require-feature";
import { SystemLookupService } from "../system/system-lookup.service";
import { BookingService } from "./booking.service";

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** `bookingPortal` feature: the public booking page's API. No login. */
@ApiTags("public")
@Public()
@RequireFeature("bookingPortal")
@Controller("public")
export class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly lookup: SystemLookupService,
  ) {}

  @Get("booking/:slug")
  async portal(@Param("slug") slug: string): Promise<BookingPortalDto> {
    await this.enterBySlug(slug);
    return this.booking.portal();
  }

  @Get("booking/:slug/availability")
  @ApiZodQuery(availabilityQuerySchema)
  async availability(
    @Param("slug") slug: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) q: z.infer<typeof availabilityQuerySchema>,
  ): Promise<AvailabilityDto> {
    await this.enterBySlug(slug);
    return this.booking.availability(q.serviceTypeId, q.date);
  }

  @Post("booking/:slug")
  // 5 bookings per IP per 10 minutes: plenty for a household, useless for a spammer.
  @RateLimit({ limit: 5, windowSec: 600, by: "ip" })
  @ApiZodBody(bookingInputSchema)
  async book(
    @Param("slug") slug: string,
    @Body(new ZodValidationPipe(bookingInputSchema)) body: BookingData,
  ): Promise<BookingConfirmationDto> {
    await this.enterBySlug(slug);
    return this.booking.book(body);
  }

  @Get("bookings/:token")
  async status(@Param("token") token: string): Promise<BookingStatusDto> {
    const organizationId = TOKEN.test(token) ? await this.lookup.organizationForBookingToken(token) : null;
    if (!organizationId) throw new AppException("NOT_FOUND", "Booking not found");
    tenantContext.set({ organizationId });
    return this.booking.status(token);
  }

  private async enterBySlug(slug: string): Promise<void> {
    const organizationId = /^[a-z0-9-]{3,40}$/.test(slug) ? await this.lookup.organizationBySlug(slug) : null;
    if (!organizationId) throw new AppException("NOT_FOUND", "Business not found");
    tenantContext.set({ organizationId });
  }
}
