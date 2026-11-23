import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ClientConfig } from "@opsdesk/config";
import { WEEKDAYS } from "@opsdesk/config";
import { currentOrganizationId } from "@opsdesk/db";
import {
  type AvailabilityDto,
  BLOCKING_STATUSES,
  type BookingConfirmationDto,
  type BookingData,
  type BookingPortalDto,
  type BookingStatusDto,
  computeSlots,
  formatJobNumber,
  overlaps,
  phoneKey,
  type Slot,
  zonedDateKey,
} from "@opsdesk/shared";
import { AuditService } from "../audit/audit.service";
import { AppException } from "../common/app-exception";
import { invalidField } from "../common/mapping";
import { CLIENT_CONFIG } from "../config/config.module";
import { ENV, type Env } from "../config/env";
import { jobInclude, toJobDto } from "../jobs/jobs.service";
import { bookingStatusUrl, formatWhen } from "../notifications/job-notifications.listener";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService, type TenantTx } from "../prisma/prisma.service";
import { DomainEvents } from "../realtime/domain-events";

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/**
 * The public booking portal. A booking becomes a REQUESTED job at the chosen
 * time with no technician: it lands in the dispatch board's "to schedule"
 * tray (live), and the office assigns someone. Availability is real (committed
 * jobs + other pending bookings), and it's re-checked under a lock on submit,
 * so two people can't book the last slot at once.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly notify: NotificationService,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async portal(): Promise<BookingPortalDto> {
    const b = this.config.business;
    const services = await this.prisma.db.serviceType.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        defaultDurationMinutes: true,
        defaultPriceMinor: true,
      },
      orderBy: { name: "asc" },
    });
    return {
      business: {
        name: b.name,
        phone: b.phone ?? null,
        email: b.email,
        address: b.address ?? null,
        logoUrl: this.config.branding.logoUrl ?? null,
      },
      timezone: b.timezone,
      currency: b.currency,
      horizonDays: this.config.booking.horizonDays,
      openDays: WEEKDAYS.filter((d) => this.config.booking.hours[d] !== null),
      services,
    };
  }

  async availability(serviceTypeId: string, dateKey: string): Promise<AvailabilityDto> {
    const slots = await this.slots(this.prisma.db, serviceTypeId, dateKey);
    return {
      date: dateKey,
      slots: slots.map((s) => ({ start: s.start, end: s.end, available: s.free > 0 })),
    };
  }

  async book(data: BookingData): Promise<BookingConfirmationDto> {
    const result = await this.prisma.db.$transaction(async (tx) => {
      // Take the org row lock first: concurrent bookings serialize from here, so the
      // availability check below can't be passed by two people for the last free slot.
      const { jobSeq } = await tx.organization.update({
        where: { id: currentOrganizationId() },
        data: { jobSeq: { increment: 1 } },
        select: { jobSeq: true },
      });
      const start = new Date(data.start);
      const dateKey = zonedDateKey(start, this.config.business.timezone);
      const slot = (await this.slots(tx, data.serviceTypeId, dateKey)).find(
        (s) => Date.parse(s.start) === start.getTime(),
      );
      if (!slot) throw invalidField("start", "That time isn't available. Please choose another.");
      if (slot.free <= 0)
        throw new AppException("CONFLICT", "Sorry, that time was just taken. Please choose another.");

      const service = await tx.serviceType.findUniqueOrThrow({ where: { id: data.serviceTypeId } });

      // Returning customer? Match on the normalised phone. We never overwrite their saved
      // details from a public form (anyone can type any number); we only fill gaps.
      const key = phoneKey(data.phone);
      let customer = await tx.customer.findFirst({ where: { phoneKey: key }, orderBy: { createdAt: "asc" } });
      if (customer) {
        if (!customer.email && data.email)
          customer = await tx.customer.update({ where: { id: customer.id }, data: { email: data.email } });
      } else {
        customer = await tx.customer.create({
          data: {
            organizationId: currentOrganizationId(),
            name: data.name,
            phone: data.phone,
            phoneKey: key,
            email: data.email,
            address: data.address,
          },
        });
      }

      const job = await tx.job.create({
        data: {
          organizationId: currentOrganizationId(),
          number: jobSeq,
          status: "REQUESTED",
          source: "BOOKING",
          bookingToken: randomBytes(24).toString("base64url"),
          customerId: customer.id,
          serviceTypeId: service.id,
          scheduledStart: new Date(slot.start),
          scheduledEnd: new Date(slot.end),
          priceMinor: service.defaultPriceMinor,
          // The visit address can differ from the customer's saved one (e.g. a second property).
          notes: [`Booked online by ${data.name}.`, `Address: ${data.address}`, data.notes]
            .filter(Boolean)
            .join("\n"),
        },
        include: { ...jobInclude, organization: { select: { slug: true } } },
      });
      await this.audit.record(
        {
          action: "job.created",
          entityType: "Job",
          entityId: job.id,
          after: { status: "REQUESTED", source: "BOOKING", scheduledStart: slot.start },
          actorType: "PUBLIC",
        },
        tx,
      );
      return { job, customer };
    });

    const { job, customer } = result;
    const dto = toJobDto(job);
    this.events.publish({
      type: "job.changed",
      organizationId: currentOrganizationId(),
      kind: "created",
      job: dto,
      previousTechnicianId: null,
      actorId: null,
    });
    const reference = formatJobNumber(job.number);
    const when = formatWhen(job.scheduledStart!, this.config);
    const entity = { type: "Job", id: job.id };
    await this.notify.toCustomer(
      { email: data.email ?? customer.email, phone: data.phone },
      "booking.received",
      {
        name: data.name.split(" ")[0] ?? data.name,
        service: job.serviceType.name,
        when,
        reference,
        statusUrl: bookingStatusUrl(this.env, job.organization.slug, job.bookingToken!),
      },
      { entity, dedupeKey: `booking-received:${job.id}` },
    );
    await this.notify.toManagers(
      "booking.new",
      {
        customer: data.name,
        phone: data.phone,
        service: job.serviceType.name,
        when,
        reference,
        url: `${this.env.APP_URL.replace(/\/$/, "")}/dispatch`,
      },
      { entity, dedupeKey: `booking-new:${job.id}` },
    );
    return { reference, token: job.bookingToken! };
  }

  async status(token: string): Promise<BookingStatusDto> {
    const job = await this.prisma.db.job.findUnique({ where: { bookingToken: token }, include: jobInclude });
    if (!job) throw new AppException("NOT_FOUND", "Booking not found");
    const b = this.config.business;
    return {
      reference: formatJobNumber(job.number),
      status: job.status,
      serviceName: job.serviceType.name,
      scheduledStart: job.scheduledStart?.toISOString() ?? null,
      scheduledEnd: job.scheduledEnd?.toISOString() ?? null,
      technicianFirstName: job.technician?.name.split(" ")[0] ?? null,
      business: { name: b.name, phone: b.phone ?? null, email: b.email },
    };
  }

  // ---------------------------------------------------------------------------

  /**
   * Slots with `free` = technicians free for the whole slot, minus other
   * pending (unassigned) online bookings overlapping it: those will need a
   * technician too, so they hold capacity until the office schedules them.
   */
  private async slots(
    db: Pick<TenantTx, "serviceType" | "user" | "job">,
    serviceTypeId: string,
    dateKey: string,
  ): Promise<Slot[]> {
    const tz = this.config.business.timezone;
    const { booking } = this.config;
    const today = zonedDateKey(new Date(), tz);
    if (dateKey < today || dateKey > addDays(today, booking.horizonDays))
      throw invalidField("date", `Choose a date in the next ${booking.horizonDays} days`);

    const service = await db.serviceType.findUnique({ where: { id: serviceTypeId } });
    if (!service || !service.isActive) throw invalidField("serviceTypeId", "Choose a service");

    const technicians = await db.user.findMany({
      where: { role: "TECHNICIAN", isActive: true },
      select: { id: true },
    });
    // A generous window around the day covers jobs crossing midnight and zone offsets.
    const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
    const from = new Date(Date.UTC(y, m - 1, d - 1));
    const to = new Date(Date.UTC(y, m - 1, d + 2));
    const jobs = await db.job.findMany({
      where: {
        scheduledStart: { lt: to },
        scheduledEnd: { gt: from },
        OR: [
          { status: { in: [...BLOCKING_STATUSES] }, technicianId: { not: null } },
          { status: "REQUESTED", technicianId: null },
        ],
      },
      select: { technicianId: true, status: true, scheduledStart: true, scheduledEnd: true },
    });
    const busy = jobs
      .filter((j) => j.technicianId)
      .map((j) => ({ technicianId: j.technicianId!, start: j.scheduledStart!, end: j.scheduledEnd! }));
    const pending = jobs.filter((j) => !j.technicianId);

    const slots = computeSlots({
      dateKey,
      timeZone: tz,
      hours: booking.hours,
      slotMinutes: booking.slotMinutes,
      durationMinutes: service.defaultDurationMinutes,
      earliest: new Date(Date.now() + booking.leadTimeHours * 3_600_000),
      technicianIds: technicians.map((t) => t.id),
      busy,
    });
    return slots.map((s) => ({
      ...s,
      free:
        s.free -
        pending.filter((p) => overlaps({ start: p.scheduledStart!, end: p.scheduledEnd! }, s)).length,
    }));
  }
}
