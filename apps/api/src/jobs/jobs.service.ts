import { Injectable } from "@nestjs/common";
import {
  currentOrganizationId,
  type JobStatus as DbJobStatus,
  type Prisma,
  type TenantPrismaClient,
} from "@opsdesk/db";
import {
  BLOCKING_STATUSES,
  type BoardQuery,
  checklistItemSchema,
  checkTransition,
  type DispatchBoardDto,
  formatJobNumber,
  type JobChangeKind,
  type JobCreateData,
  type JobDto,
  type JobListQuery,
  type JobStatsDto,
  type JobStatus,
  type JobTransitionInput,
  type JobUpdateData,
  JOB_STATUSES,
  type Paginated,
  SCHEDULE_EDITABLE_STATUSES,
  type ScheduleConflictDto,
  type ScheduleJobData,
  zonedDayRange,
} from "@opsdesk/shared";
import { z } from "zod";
import { auditDiff, snapshot } from "../audit/audit-diff";
import { AuditService } from "../audit/audit.service";
import type { RequestUser } from "../auth/auth.types";
import { AppException } from "../common/app-exception";
import { invalidField, iso, isoOrNull, pageArgs } from "../common/mapping";
import { PrismaService } from "../prisma/prisma.service";
import { DomainEvents } from "../realtime/domain-events";

export const jobInclude = {
  customer: { select: { id: true, name: true, phone: true, address: true } },
  serviceType: { select: { id: true, name: true, defaultDurationMinutes: true } },
  technician: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.JobInclude;

type JobRow = Prisma.JobGetPayload<{ include: typeof jobInclude }>;
type Db = Pick<TenantPrismaClient, "job" | "user" | "serviceType" | "customer">;

const AUDITED = [
  "serviceTypeId",
  "technicianId",
  "scheduledStart",
  "scheduledEnd",
  "notes",
  "priceMinor",
  "checklist",
] as const;
const SCHEDULE_FIELDS = ["technicianId", "scheduledStart", "scheduledEnd"] as const;

const checklistArray = z.array(checklistItemSchema).catch([]);

export function toJobDto(j: JobRow): JobDto {
  return {
    id: j.id,
    number: j.number,
    status: j.status,
    customer: j.customer,
    serviceType: j.serviceType,
    technician: j.technician,
    scheduledStart: isoOrNull(j.scheduledStart),
    scheduledEnd: isoOrNull(j.scheduledEnd),
    startedAt: isoOrNull(j.startedAt),
    completedAt: isoOrNull(j.completedAt),
    cancelledAt: isoOrNull(j.cancelledAt),
    cancellationReason: j.cancellationReason,
    checklist: checklistArray.parse(j.checklist),
    notes: j.notes,
    priceMinor: j.priceMinor,
    version: j.version,
    source: j.source,
    createdAt: iso(j.createdAt),
    updatedAt: iso(j.updatedAt),
  };
}

const STALE = "This job was changed by someone else. Reload to see the latest version.";

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async list(query: JobListQuery, actor: RequestUser): Promise<Paginated<JobDto>> {
    const where = this.buildWhere(query, actor);
    const orderBy: Prisma.JobOrderByWithRelationInput[] =
      query.sort === "-createdAt"
        ? [{ createdAt: "desc" }]
        : [{ scheduledStart: { sort: query.sort === "scheduledStart" ? "asc" : "desc", nulls: "last" } }];
    const [rows, total] = await Promise.all([
      this.prisma.db.job.findMany({
        where,
        include: jobInclude,
        orderBy: [...orderBy, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.db.job.count({ where }),
    ]);
    return { items: rows.map(toJobDto), page: query.page, pageSize: query.pageSize, total };
  }

  async get(id: string, actor: RequestUser): Promise<JobDto> {
    return toJobDto(await this.findVisible(this.prisma.db, id, actor));
  }

  /** One grouped query + two counts; no per-status round trips. */
  async stats(actor: RequestUser): Promise<JobStatsDto> {
    const scope: Prisma.JobWhereInput = actor.role === "TECHNICIAN" ? { technicianId: actor.id } : {};
    const org = await this.prisma.db.organization.findUniqueOrThrow({
      where: { id: currentOrganizationId() },
      select: { timezone: true },
    });
    const today = zonedDayRange(new Date(), org.timezone);
    const [grouped, scheduledToday, unassigned] = await Promise.all([
      this.prisma.db.job.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
      this.prisma.db.job.count({
        where: {
          ...scope,
          status: { not: "CANCELLED" },
          scheduledStart: { gte: today.start, lt: today.end },
        },
      }),
      this.prisma.db.job.count({ where: { ...scope, status: "REQUESTED", technicianId: null } }),
    ]);
    const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
    for (const g of grouped) byStatus[g.status] = g._count._all;
    return { byStatus, scheduledToday, unassigned };
  }

  /** Everything the dispatch board needs for a date range, in three parallel queries. */
  async board(q: BoardQuery): Promise<DispatchBoardDto> {
    const [technicians, jobs, unscheduled] = await Promise.all([
      this.prisma.db.user.findMany({
        where: { role: "TECHNICIAN", isActive: true },
        select: { id: true, name: true, avatarUrl: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.db.job.findMany({
        // Overlap, not containment: a job spanning midnight shows on both days.
        where: {
          technicianId: { not: null },
          status: { not: "CANCELLED" },
          scheduledStart: { lt: q.to },
          scheduledEnd: { gt: q.from },
        },
        include: jobInclude,
        orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
        take: 1000,
      }),
      this.prisma.db.job.findMany({
        where: { status: "REQUESTED", OR: [{ technicianId: null }, { scheduledStart: null }] },
        include: jobInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
      }),
    ]);
    return { technicians, jobs: jobs.map(toJobDto), unscheduled: unscheduled.map(toJobDto) };
  }

  // ---------------------------------------------------------------------------
  // Commands. Each one: one transaction, audit inside it, event after commit.
  // ---------------------------------------------------------------------------

  async create(data: JobCreateData, actor: RequestUser): Promise<JobDto> {
    const job = await this.prisma.db.$transaction(async (tx) => {
      const service = await this.validateRefs(tx, data);
      const customer = await tx.customer.findUnique({ where: { id: data.customerId }, select: { id: true } });
      if (!customer) throw invalidField("customerId", "Customer not found");

      const scheduledEnd = defaultEnd(data.scheduledStart, data.scheduledEnd, service.defaultDurationMinutes);
      const status: DbJobStatus = data.technicianId && data.scheduledStart ? "SCHEDULED" : "REQUESTED";
      if (status === "SCHEDULED") {
        await this.assertNoConflict(tx, {
          technicianId: data.technicianId,
          start: data.scheduledStart,
          end: scheduledEnd,
        });
      }
      // Row-locking increment: concurrent creates in one org serialize here, so numbers never collide.
      const { jobSeq } = await tx.organization.update({
        where: { id: currentOrganizationId() },
        data: { jobSeq: { increment: 1 } },
        select: { jobSeq: true },
      });

      const created = await tx.job.create({
        data: {
          organizationId: currentOrganizationId(),
          number: jobSeq,
          status,
          source: actor.apiKey ? "API" : "DASHBOARD",
          customerId: data.customerId,
          serviceTypeId: data.serviceTypeId,
          technicianId: data.technicianId,
          scheduledStart: data.scheduledStart,
          scheduledEnd,
          notes: data.notes,
          priceMinor: data.priceMinor ?? service.defaultPriceMinor,
          checklist: data.checklist,
        },
        include: jobInclude,
      });
      await this.audit.record(
        {
          action: "job.created",
          entityType: "Job",
          entityId: created.id,
          after: { ...snapshot(created, AUDITED), status },
        },
        tx,
      );
      return toJobDto(created);
    });
    this.publish("created", job, actor, null);
    return job;
  }

  async update(id: string, data: JobUpdateData, actor: RequestUser): Promise<JobDto> {
    let previousTechnicianId: string | null = null;
    const job = await this.prisma.db.$transaction(async (tx) => {
      const before = await this.findVisible(tx, id, actor);
      previousTechnicianId = before.technicianId;
      if (before.version !== data.version) throw new AppException("CONFLICT", STALE);

      const service = await this.validateRefs(tx, data);
      const scheduledEnd = defaultEnd(data.scheduledStart, data.scheduledEnd, service.defaultDurationMinutes);

      const scheduleChanged =
        before.technicianId !== data.technicianId ||
        before.scheduledStart?.getTime() !== data.scheduledStart?.getTime() ||
        before.scheduledEnd?.getTime() !== scheduledEnd?.getTime();
      if (scheduleChanged && !SCHEDULE_EDITABLE_STATUSES.includes(before.status)) {
        throw new AppException("CONFLICT", "The schedule can't change once the technician is on the way");
      }
      if (before.status === "SCHEDULED" && (!data.technicianId || !data.scheduledStart)) {
        throw new AppException(
          "BAD_REQUEST",
          "A scheduled job needs a technician and a time. Unschedule it first.",
        );
      }
      if (scheduleChanged && BLOCKING_STATUSES.includes(before.status)) {
        await this.assertNoConflict(tx, {
          id,
          technicianId: data.technicianId,
          start: data.scheduledStart,
          end: scheduledEnd,
        });
      }

      // Compare-and-swap on version: a concurrent edit makes this match zero rows.
      const res = await tx.job.updateMany({
        where: { id, version: data.version },
        data: {
          serviceTypeId: data.serviceTypeId,
          technicianId: data.technicianId,
          scheduledStart: data.scheduledStart,
          scheduledEnd,
          notes: data.notes,
          priceMinor: data.priceMinor,
          checklist: data.checklist,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) throw new AppException("CONFLICT", STALE);

      const after = await tx.job.findUniqueOrThrow({ where: { id }, include: jobInclude });
      const diff = auditDiff(before, after, AUDITED);
      if (diff)
        await this.audit.record({ action: "job.updated", entityType: "Job", entityId: id, ...diff }, tx);
      return toJobDto(after);
    });
    this.publish("updated", job, actor, previousTechnicianId);
    return job;
  }

  /**
   * The dispatch board's command: put the job on a technician at a time.
   * Keeps the job's duration unless an end is given; promotes REQUESTED → SCHEDULED.
   */
  async schedule(id: string, data: ScheduleJobData, actor: RequestUser): Promise<JobDto> {
    let previousTechnicianId: string | null = null;
    const job = await this.prisma.db.$transaction(async (tx) => {
      const before = await this.findVisible(tx, id, actor);
      previousTechnicianId = before.technicianId;
      if (before.version !== data.version) throw new AppException("CONFLICT", STALE);
      if (!SCHEDULE_EDITABLE_STATUSES.includes(before.status)) {
        throw new AppException("CONFLICT", "Only requested or scheduled jobs can be moved");
      }
      await this.assertTechnician(tx, data.technicianId);

      const durationMs =
        before.scheduledStart && before.scheduledEnd
          ? before.scheduledEnd.getTime() - before.scheduledStart.getTime()
          : before.serviceType.defaultDurationMinutes * 60_000;
      const end = data.scheduledEnd ?? new Date(data.scheduledStart.getTime() + durationMs);
      const promote = before.status === "REQUESTED";
      if (promote) {
        const check = checkTransition({
          from: "REQUESTED",
          to: "SCHEDULED",
          actor,
          job: { technicianId: data.technicianId, scheduledStart: data.scheduledStart, scheduledEnd: end },
        });
        if (!check.ok)
          throw new AppException(check.code === "FORBIDDEN" ? "FORBIDDEN" : "BAD_REQUEST", check.message);
      }
      await this.assertNoConflict(tx, {
        id,
        technicianId: data.technicianId,
        start: data.scheduledStart,
        end,
      });

      const res = await tx.job.updateMany({
        where: { id, version: data.version },
        data: {
          technicianId: data.technicianId,
          scheduledStart: data.scheduledStart,
          scheduledEnd: end,
          version: { increment: 1 },
          ...(promote && { status: "SCHEDULED" as const }),
        },
      });
      if (res.count === 0) throw new AppException("CONFLICT", STALE);

      const after = await tx.job.findUniqueOrThrow({ where: { id }, include: jobInclude });
      const diff = auditDiff(before, after, SCHEDULE_FIELDS);
      if (diff)
        await this.audit.record({ action: "job.rescheduled", entityType: "Job", entityId: id, ...diff }, tx);
      if (promote) {
        await this.audit.record(
          {
            action: "job.status_changed",
            entityType: "Job",
            entityId: id,
            before: { status: "REQUESTED" },
            after: { status: "SCHEDULED" },
          },
          tx,
        );
      }
      return toJobDto(after);
    });
    this.publish("rescheduled", job, actor, previousTechnicianId);
    return job;
  }

  async transition(id: string, input: JobTransitionInput, actor: RequestUser): Promise<JobDto> {
    const job = await this.prisma.db.$transaction(async (tx) => {
      const before = await this.findVisible(tx, id, actor);
      if (input.version !== undefined && input.version !== before.version)
        throw new AppException("CONFLICT", STALE);

      const check = checkTransition({
        from: before.status,
        to: input.to,
        actor,
        job: before,
        reason: input.reason,
      });
      if (!check.ok) {
        const code =
          check.code === "FORBIDDEN"
            ? "FORBIDDEN"
            : check.code === "INVALID_TRANSITION"
              ? "CONFLICT"
              : "BAD_REQUEST";
        throw new AppException(code, check.message);
      }
      if (input.to === "SCHEDULED") {
        await this.assertNoConflict(tx, {
          id,
          technicianId: before.technicianId,
          start: before.scheduledStart,
          end: before.scheduledEnd,
        });
      }

      const now = new Date();
      const sideEffects: Prisma.JobUpdateManyMutationInput =
        input.to === "IN_PROGRESS"
          ? { startedAt: now }
          : input.to === "COMPLETED"
            ? { completedAt: now }
            : input.to === "CANCELLED"
              ? { cancelledAt: now, cancellationReason: input.reason ?? null }
              : {};

      // Conditional on the status we validated against: two people clicking at once can't both win.
      const res = await tx.job.updateMany({
        where: { id, status: before.status },
        data: { status: input.to, version: { increment: 1 }, ...sideEffects },
      });
      if (res.count === 0) throw new AppException("CONFLICT", STALE);

      await this.audit.record(
        {
          action: "job.status_changed",
          entityType: "Job",
          entityId: id,
          before: { status: before.status },
          after: { status: input.to, ...(input.reason ? { reason: input.reason } : {}) },
        },
        tx,
      );
      return toJobDto(await tx.job.findUniqueOrThrow({ where: { id }, include: jobInclude }));
    });
    this.publish("status_changed", job, actor, null);
    return job;
  }

  // ---------------------------------------------------------------------------

  publish(kind: JobChangeKind, job: JobDto, actor: RequestUser, previousTechnicianId: string | null): void {
    this.events.publish({
      type: "job.changed",
      organizationId: actor.organizationId,
      kind,
      job,
      previousTechnicianId,
      actorId: actor.id,
    });
  }

  /**
   * Friendly overlap check (409 naming the clashing jobs). The DB exclusion
   * constraint is the backstop for races between two concurrent requests.
   */
  private async assertNoConflict(
    db: Pick<TenantPrismaClient, "job">,
    p: { id?: string; technicianId: string | null; start: Date | null; end: Date | null },
  ): Promise<void> {
    if (!p.technicianId || !p.start || !p.end) return;
    const clashes = await db.job.findMany({
      where: {
        ...(p.id && { id: { not: p.id } }),
        technicianId: p.technicianId,
        status: { in: [...BLOCKING_STATUSES] },
        scheduledStart: { lt: p.end },
        scheduledEnd: { gt: p.start },
      },
      select: {
        id: true,
        number: true,
        scheduledStart: true,
        scheduledEnd: true,
        customer: { select: { name: true } },
      },
      orderBy: { scheduledStart: "asc" },
      take: 5,
    });
    if (!clashes.length) return;
    const conflicts: ScheduleConflictDto[] = clashes.map((c) => ({
      id: c.id,
      number: c.number,
      customerName: c.customer.name,
      scheduledStart: iso(c.scheduledStart!),
      scheduledEnd: iso(c.scheduledEnd!),
    }));
    const first = conflicts[0]!;
    throw new AppException(
      "CONFLICT",
      `This technician is already booked for ${formatJobNumber(first.number)} (${first.customerName}) at that time`,
      { scheduledStart: ["Overlaps another job for this technician"] },
      conflicts,
    );
  }

  private buildWhere(q: JobListQuery, actor: RequestUser): Prisma.JobWhereInput {
    const and: Prisma.JobWhereInput[] = [];
    if (actor.role === "TECHNICIAN") and.push({ technicianId: actor.id });
    else if (q.technicianId)
      and.push({ technicianId: q.technicianId === "unassigned" ? null : q.technicianId });
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.customerId) and.push({ customerId: q.customerId });
    if (q.from || q.to)
      and.push({ scheduledStart: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } });
    if (q.q) {
      const num = Number(q.q.replace(/^job-?/i, ""));
      and.push({
        OR: [
          { customer: { name: { contains: q.q, mode: "insensitive" } } },
          { notes: { contains: q.q, mode: "insensitive" } },
          ...(Number.isInteger(num) && num > 0 ? [{ number: num }] : []),
        ],
      });
    }
    return { AND: and };
  }

  /** Tenant scoping is automatic; this adds the technician "own jobs only" rule. */
  async findVisible(db: Pick<TenantPrismaClient, "job">, id: string, actor: RequestUser): Promise<JobRow> {
    const job = await db.job.findUnique({ where: { id }, include: jobInclude });
    if (!job || (actor.role === "TECHNICIAN" && job.technicianId !== actor.id)) {
      throw new AppException("NOT_FOUND", "Job not found");
    }
    return job;
  }

  /**
   * Optional relations (technician) use a plain FK, so the composite-FK guarantee
   * doesn't apply: verify the user is an active technician IN THIS TENANT here.
   */
  private async assertTechnician(db: Pick<Db, "user">, technicianId: string): Promise<void> {
    const tech = await db.user.findFirst({
      where: { id: technicianId, role: "TECHNICIAN", isActive: true },
      select: { id: true },
    });
    if (!tech) throw invalidField("technicianId", "Technician not found");
  }

  private async validateRefs(
    db: Db,
    data: { serviceTypeId: string; technicianId: string | null },
  ): Promise<{ defaultDurationMinutes: number; defaultPriceMinor: number }> {
    const service = await db.serviceType.findUnique({
      where: { id: data.serviceTypeId },
      select: { isActive: true, defaultDurationMinutes: true, defaultPriceMinor: true },
    });
    if (!service) throw invalidField("serviceTypeId", "Service not found");
    if (data.technicianId) await this.assertTechnician(db, data.technicianId);
    return service;
  }
}

function defaultEnd(start: Date | null, end: Date | null, durationMinutes: number): Date | null {
  if (!start) return null;
  return end ?? new Date(start.getTime() + durationMinutes * 60_000);
}
