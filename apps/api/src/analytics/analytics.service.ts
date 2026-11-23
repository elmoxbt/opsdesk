import { Inject, Injectable } from "@nestjs/common";
import type { ClientConfig } from "@opsdesk/config";
import {
  addDays,
  type AnalyticsOverviewDto,
  type AnalyticsQuery,
  bucketOf,
  enumerateBuckets,
  granularityFor,
  openMinutes,
  OPEN_INVOICE_STATUSES,
  previousPeriod,
  zonedDateKey,
  zonedTimeToUtc,
} from "@opsdesk/shared";
import { CLIENT_CONFIG } from "../config/config.module";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 86_400_000;
/** Statuses where a technician's time was (or is) committed to the job. */
const BOOKED = ["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "INVOICED", "PAID"] as const;
const DONE = ["COMPLETED", "INVOICED", "PAID"] as const;

interface Window {
  start: Date;
  end: Date;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const within = (d: Date | null, w: Window) => !!d && d >= w.start && d < w.end;
const clippedMinutes = (s: Date, e: Date, w: Window) =>
  Math.max(0, (Math.min(e.getTime(), w.end.getTime()) - Math.max(s.getTime(), w.start.getTime())) / 60_000);

/**
 * Owner analytics. One request, a handful of tenant-scoped queries for the
 * current AND previous period together, aggregated in memory.
 *
 * Why not SQL GROUP BY: day buckets must be in the business's time zone (not
 * the server's), queries stay inside the tenant-isolation extension (raw SQL
 * would bypass it), and a service business produces thousands of rows a year,
 * not millions. If that changes, the same DTO can be served from nightly
 * rollup tables without touching the UI.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
  ) {}

  async overview(q: AnalyticsQuery, now = new Date()): Promise<AnalyticsOverviewDto> {
    const tz = this.config.business.timezone;
    const prev = previousPeriod(q.from, q.to);
    const startOf = (key: string) => {
      const [y, m, d] = key.split("-").map(Number) as [number, number, number];
      return zonedTimeToUtc(y, m, d, 0, 0, tz);
    };
    const cur: Window = { start: startOf(q.from), end: startOf(addDays(q.to, 1)) };
    const old: Window = { start: startOf(prev.from), end: cur.start };
    const both = { gte: old.start, lt: cur.end };
    const g = granularityFor(q.from, q.to);
    const db = this.prisma.db;

    const [payments, issued, paidInvoices, completed, booked, technicians, sources, open] = await Promise.all(
      [
        db.payment.findMany({
          where: { status: "SUCCEEDED", paidAt: both },
          select: { amountMinor: true, paidAt: true },
        }),
        db.invoice.findMany({
          where: { sentAt: { not: null }, status: { not: "VOID" }, issueDate: both },
          select: { totalMinor: true, issueDate: true },
        }),
        db.invoice.findMany({
          where: { status: "PAID", paidAt: both },
          select: { issueDate: true, paidAt: true },
        }),
        db.job.findMany({
          where: { status: { in: [...DONE] }, completedAt: both },
          select: {
            completedAt: true,
            priceMinor: true,
            technicianId: true,
            serviceType: { select: { id: true, name: true, defaultPriceMinor: true } },
          },
        }),
        db.job.findMany({
          where: {
            status: { in: [...BOOKED] },
            technicianId: { not: null },
            scheduledStart: { lt: cur.end },
            scheduledEnd: { gt: old.start },
          },
          select: { technicianId: true, scheduledStart: true, scheduledEnd: true },
        }),
        db.user.findMany({
          where: { role: "TECHNICIAN", isActive: true },
          select: { id: true, name: true, avatarUrl: true },
          orderBy: { name: "asc" },
        }),
        db.job.groupBy({
          by: ["source"],
          where: { createdAt: { gte: cur.start, lt: cur.end } },
          _count: true,
        }),
        db.invoice.findMany({
          where: { status: { in: [...OPEN_INVOICE_STATUSES] } },
          select: { totalMinor: true, amountPaidMinor: true, dueDate: true },
        }),
      ],
    );

    // ---- KPIs, current vs previous ------------------------------------------
    const jobValue = (j: (typeof completed)[number]) => j.priceMinor ?? j.serviceType.defaultPriceMinor;
    const kpisFor = (w: Window, days: { from: string; to: string }) => {
      const done = completed.filter((j) => within(j.completedAt, w));
      const paid = paidInvoices.filter((i) => within(i.paidAt, w));
      const capacity = openMinutes(days.from, days.to, this.config.booking.hours) * technicians.length;
      const bookedMinutes = sum(booked.map((b) => clippedMinutes(b.scheduledStart!, b.scheduledEnd!, w)));
      return {
        revenueMinor: sum(payments.filter((p) => within(p.paidAt, w)).map((p) => p.amountMinor)),
        invoicedMinor: sum(issued.filter((i) => within(i.issueDate, w)).map((i) => i.totalMinor)),
        jobsCompleted: done.length,
        avgJobValueMinor: done.length ? Math.round(sum(done.map(jobValue)) / done.length) : null,
        utilisation: capacity > 0 ? Math.min(1, bookedMinutes / capacity) : null,
        avgDaysToPay: paid.length
          ? Math.round(
              (sum(paid.map((i) => (i.paidAt!.getTime() - i.issueDate.getTime()) / DAY_MS)) / paid.length) *
                10,
            ) / 10
          : null,
      };
    };
    const a = kpisFor(cur, q);
    const b = kpisFor(old, prev);
    const kpis = Object.fromEntries(
      (Object.keys(a) as Array<keyof typeof a>).map((k) => [k, { value: a[k], previous: b[k] }]),
    ) as AnalyticsOverviewDto["kpis"];

    // ---- Series (current period, every bucket present) -------------------------
    const series = new Map(
      enumerateBuckets(q.from, q.to, g).map((k) => [k, { bucket: k, revenueMinor: 0, jobsCompleted: 0 }]),
    );
    const bucket = (d: Date) => series.get(bucketOf(zonedDateKey(d, tz), g));
    for (const p of payments) if (within(p.paidAt, cur)) bucket(p.paidAt!)!.revenueMinor += p.amountMinor;
    for (const j of completed) if (within(j.completedAt, cur)) bucket(j.completedAt!)!.jobsCompleted += 1;

    // ---- Breakdowns (current period) --------------------------------------------
    const doneNow = completed.filter((j) => within(j.completedAt, cur));
    const services = new Map<string, AnalyticsOverviewDto["byService"][number]>();
    for (const j of doneNow) {
      const s = services.get(j.serviceType.id) ?? {
        id: j.serviceType.id,
        name: j.serviceType.name,
        jobs: 0,
        valueMinor: 0,
      };
      s.jobs += 1;
      s.valueMinor += jobValue(j);
      services.set(s.id, s);
    }
    const capacityPerTech = openMinutes(q.from, q.to, this.config.booking.hours);
    const techRows = technicians.map((t) => {
      const mine = doneNow.filter((j) => j.technicianId === t.id);
      const minutes = sum(
        booked
          .filter((x) => x.technicianId === t.id)
          .map((x) => clippedMinutes(x.scheduledStart!, x.scheduledEnd!, cur)),
      );
      return {
        id: t.id,
        name: t.name,
        avatarUrl: t.avatarUrl,
        jobsCompleted: mine.length,
        bookedHours: Math.round((minutes / 60) * 10) / 10,
        utilisation: capacityPerTech > 0 ? Math.min(1, minutes / capacityPerTech) : 0,
        valueMinor: sum(mine.map(jobValue)),
      };
    });

    const receivables = { currentMinor: 0, days1to30Minor: 0, days31to60Minor: 0, days60plusMinor: 0 };
    for (const i of open) {
      const owed = i.totalMinor - i.amountPaidMinor;
      const late = Math.floor((now.getTime() - i.dueDate.getTime()) / DAY_MS);
      if (now <= i.dueDate) receivables.currentMinor += owed;
      else if (late <= 30) receivables.days1to30Minor += owed;
      else if (late <= 60) receivables.days31to60Minor += owed;
      else receivables.days60plusMinor += owed;
    }

    return {
      range: { from: q.from, to: q.to, previousFrom: prev.from, previousTo: prev.to, granularity: g },
      currency: this.config.business.currency,
      generatedAt: now.toISOString(),
      kpis,
      series: [...series.values()],
      byService: [...services.values()].sort((x, y) => y.valueMinor - x.valueMinor),
      technicians: techRows.sort((x, y) => y.valueMinor - x.valueMinor || x.name.localeCompare(y.name)),
      sources: {
        DASHBOARD: sources.find((s) => s.source === "DASHBOARD")?._count ?? 0,
        BOOKING: sources.find((s) => s.source === "BOOKING")?._count ?? 0,
        API: sources.find((s) => s.source === "API")?._count ?? 0,
      },
      receivables,
    };
  }
}
