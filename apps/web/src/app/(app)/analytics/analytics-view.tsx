"use client";

import {
  addDays,
  type AnalyticsOverviewDto,
  analyticsQuerySchema,
  formatMoney,
  type Granularity,
  type Kpi,
  percentChange,
  zonedDateKey,
} from "@opsdesk/shared";
import { Avatar } from "@opsdesk/ui/avatar";
import { AreaChart, BarList, ChartFrame, ColumnChart, Meter, SegmentedBar } from "@opsdesk/ui/charts";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { CountUp } from "@opsdesk/ui/count-up";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Input } from "@opsdesk/ui/input";
import { PageTitle } from "@opsdesk/ui/page-title";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { cn } from "@opsdesk/ui/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useMemo } from "react";
import { useSession } from "@/hooks/use-session";
import { useUrlState } from "@/hooks/use-url-state";
import { errorMessage } from "@/lib/api/client";
import { useAnalytics } from "@/lib/api/hooks";

const KEYS = ["from", "to"] as const;

type Preset = { id: string; label: string; range: (today: string) => { from: string; to: string } };
const PRESETS: Preset[] = [
  { id: "7d", label: "7 days", range: (t) => ({ from: addDays(t, -6), to: t }) },
  { id: "30d", label: "30 days", range: (t) => ({ from: addDays(t, -29), to: t }) },
  { id: "90d", label: "90 days", range: (t) => ({ from: addDays(t, -89), to: t }) },
  { id: "month", label: "This month", range: (t) => ({ from: `${t.slice(0, 7)}-01`, to: t }) },
  { id: "year", label: "This year", range: (t) => ({ from: `${t.slice(0, 4)}-01-01`, to: t }) },
];

export function AnalyticsView() {
  const user = useSession();
  const config = useClientConfig();
  const tz = user.organization.timezone;
  const today = zonedDateKey(new Date(), tz);
  const [url, setUrl] = useUrlState(KEYS);
  const parsed = analyticsQuerySchema.safeParse({ from: url.from, to: url.to });
  const range = parsed.success ? parsed.data : PRESETS[1]!.range(today);
  const report = useAnalytics(range);
  const activePreset = PRESETS.find((p) => {
    const r = p.range(today);
    return r.from === range.from && r.to === range.to;
  });

  if (user.role !== "OWNER")
    return (
      <EmptyState
        illustration={NotFoundIllustration}
        title="Owners only"
        description="Analytics shows revenue and utilisation, so it's visible to the business owner."
      />
    );

  const currency = report.data?.currency ?? user.organization.currency;
  const locale = config.business.locale;
  // Analytics reads in whole currency units: kobo-level precision is noise here.
  const money = (minor: number) => formatMoney(Math.round(minor / 100) * 100, currency, locale);
  const compact = (minor: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(minor / 100);

  return (
    <div className="space-y-6">
      <PageTitle>Analytics</PageTitle>
      <PageHeader
        title="Analytics"
        description="How the business is doing: money in, work done, and where time goes."
      />

      {/* Filters: one row, above everything they affect. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div role="group" aria-label="Date range" className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={activePreset?.id === p.id}
              onClick={() => setUrl(p.range(today))}
              className={cn(
                "motion-press h-9 rounded-lg px-3 text-sm font-medium transition-[transform,background-color] duration-150 active:scale-[0.98]",
                activePreset?.id === p.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Input
            type="date"
            aria-label="From"
            className="h-9 w-auto"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setUrl({ from: e.target.value, to: range.to })}
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To"
            className="h-9 w-auto"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setUrl({ from: range.from, to: e.target.value })}
          />
        </div>
        {!parsed.success && (url.from || url.to) && (
          <p className="text-sm text-destructive">
            That range isn&apos;t valid (max 366 days); showing the last 30 days.
          </p>
        )}
      </div>

      {report.isPending ? (
        <LoadingState />
      ) : report.isError ? (
        <ErrorState message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
      ) : (
        <div className={cn("space-y-6", report.isPlaceholderData && "opacity-60 transition-opacity")}>
          <Report data={report.data} money={money} compact={compact} locale={locale} />
        </div>
      )}
    </div>
  );
}

function Report({
  data,
  money,
  compact,
  locale,
}: {
  data: AnalyticsOverviewDto;
  money: (m: number) => string;
  compact: (m: number) => string;
  locale: string;
}) {
  const g = data.range.granularity;
  const label = useMemo(() => bucketLabel(g, locale), [g, locale]);
  // A partial first week/month is labelled from the range start, not the Monday/1st before it.
  const at = (bucket: string) => label(bucket < data.range.from ? data.range.from : bucket);
  const revenue = data.series.map((s) => ({ key: s.bucket, label: at(s.bucket), value: s.revenueMinor }));
  const jobs = data.series.map((s) => ({ key: s.bucket, label: at(s.bucket), value: s.jobsCompleted }));
  const per = g === "day" ? "day" : g === "week" ? "week" : "month";
  const k = data.kpis;
  const fmtCurrency = { style: "currency", currency: data.currency, maximumFractionDigits: 0 } as const;
  const r = data.receivables;
  const owed = r.currentMinor + r.days1to30Minor + r.days31to60Minor + r.days60plusMinor;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiTile
          title="Revenue received"
          kpi={k.revenueMinor}
          render={(v) => <CountUp value={v / 100} format={fmtCurrency} locale={locale} />}
        />
        <KpiTile
          title="Invoiced"
          kpi={k.invoicedMinor}
          render={(v) => <CountUp value={v / 100} format={fmtCurrency} locale={locale} />}
        />
        <KpiTile
          title="Jobs completed"
          kpi={k.jobsCompleted}
          render={(v) => <CountUp value={v} locale={locale} />}
        />
        <KpiTile
          title="Average job value"
          kpi={k.avgJobValueMinor}
          render={(v) => <CountUp value={v / 100} format={fmtCurrency} locale={locale} />}
        />
        <KpiTile
          title="Technician utilisation"
          kpi={k.utilisation}
          render={(v) => (
            <CountUp value={v} format={{ style: "percent", maximumFractionDigits: 0 }} locale={locale} />
          )}
          hint="Booked hours ÷ opening hours"
        />
        <KpiTile
          title="Days to get paid"
          kpi={k.avgDaysToPay}
          lowerIsBetter
          render={(v) => <CountUp value={v} format={{ maximumFractionDigits: 1 }} locale={locale} />}
          hint="Issue → payment, average"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <ChartFrame
          className="xl:col-span-2"
          title={`Revenue received per ${per}`}
          summary={`${money(k.revenueMinor.value ?? 0)} in this period`}
          table={{
            columns: [g === "day" ? "Day" : g === "week" ? "Week of" : "Month", "Revenue"],
            rows: revenue.map((p) => [p.label, money(p.value)]),
          }}
        >
          <AreaChart
            points={revenue}
            format={money}
            formatAxis={compact}
            label={`Revenue received per ${per}`}
          />
        </ChartFrame>
        <ChartFrame
          title={`Jobs completed per ${per}`}
          summary={`${k.jobsCompleted.value ?? 0} in total`}
          table={{
            columns: [g === "day" ? "Day" : g === "week" ? "Week of" : "Month", "Jobs"],
            rows: jobs.map((p) => [p.label, String(p.value)]),
          }}
        >
          <ColumnChart
            points={jobs}
            format={(v) => `${v} job${v === 1 ? "" : "s"}`}
            label={`Jobs completed per ${per}`}
          />
        </ChartFrame>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame
          title="Work done by service"
          summary="Value of completed jobs"
          table={{
            columns: ["Service", "Value"],
            rows: data.byService.map((s) => [`${s.name} (${s.jobs})`, money(s.valueMinor)]),
          }}
        >
          {data.byService.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed jobs in this period.</p>
          ) : (
            <BarList
              items={data.byService.map((s) => ({
                key: s.id,
                label: s.name,
                value: s.valueMinor,
                hint: `${s.jobs} job${s.jobs === 1 ? "" : "s"}`,
              }))}
              format={money}
            />
          )}
        </ChartFrame>

        <ChartFrame
          title="Unpaid invoices by age"
          summary={`${money(owed)} owed in total, as of today`}
          table={{
            columns: ["Age", "Owed"],
            rows: [
              ["Not yet due", money(r.currentMinor)],
              ["1–30 days late", money(r.days1to30Minor)],
              ["31–60 days late", money(r.days31to60Minor)],
              ["Over 60 days late", money(r.days60plusMinor)],
            ],
          }}
        >
          <BarList
            items={[
              { key: "current", label: "Not yet due", value: r.currentMinor },
              { key: "30", label: "1–30 days late", value: r.days1to30Minor },
              { key: "60", label: "31–60 days late", value: r.days31to60Minor },
              { key: "60+", label: "Over 60 days late", value: r.days60plusMinor },
            ]}
            format={money}
            colors={["var(--chart-seq-1)", "var(--chart-seq-2)", "var(--chart-seq-3)", "var(--chart-seq-4)"]}
          />
        </ChartFrame>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="min-w-0 rounded-2xl border bg-card p-5 lg:col-span-2" aria-labelledby="techs">
          <h2 id="techs" className="mb-4 font-semibold">
            Technicians
          </h2>
          {data.technicians.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active technicians.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Technician</th>
                    <th className="pb-2 text-right font-medium">Jobs done</th>
                    <th className="pb-2 text-right font-medium">Hours booked</th>
                    <th className="pb-2 pl-4 font-medium">Utilisation</th>
                    <th className="pb-2 text-right font-medium">Work value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.technicians.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <Avatar name={t.name} src={t.avatarUrl} size="sm" />
                          {t.name}
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">{t.jobsCompleted}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{t.bookedHours}</td>
                      <td className="py-2 pl-4">
                        <Meter value={t.utilisation} label={`${t.name} utilisation`} />
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">{money(t.valueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-2xl border bg-card p-5" aria-labelledby="sources">
          <h2 id="sources" className="font-semibold">
            Where new jobs came from
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">Jobs created in this period</p>
          <SegmentedBar
            parts={[
              { key: "DASHBOARD", label: "Office", value: data.sources.DASHBOARD, color: "var(--chart-1)" },
              {
                key: "BOOKING",
                label: "Online booking",
                value: data.sources.BOOKING,
                color: "var(--chart-2)",
              },
              { key: "API", label: "API", value: data.sources.API, color: "var(--chart-3)" },
            ]}
          />
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        {data.range.from} to {data.range.to}, compared with {data.range.previousFrom} to{" "}
        {data.range.previousTo}. Dates are in the business&apos;s time zone. Revenue is money received; work
        value is the price of completed jobs.
      </p>
    </>
  );
}

function KpiTile({
  title,
  kpi,
  render,
  hint,
  lowerIsBetter,
}: {
  title: string;
  kpi: Kpi;
  render: (v: number) => React.ReactNode;
  hint?: string;
  lowerIsBetter?: boolean;
}) {
  const change = percentChange(kpi.value, kpi.previous);
  const good = change === null ? null : lowerIsBetter ? change < 0 : change > 0;
  const Icon =
    change === null || Math.abs(change) < 0.005 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
        {kpi.value === null ? "—" : render(kpi.value)}
      </p>
      <p className="mt-1 flex items-center gap-1 text-xs">
        {change === null ? (
          <span className="text-muted-foreground">{hint ?? "No previous data to compare"}</span>
        ) : (
          <>
            {/* Direction is in the icon AND the words; colour only reinforces it. */}
            <Icon
              className={cn(
                "size-3.5",
                good === null || Math.abs(change) < 0.005
                  ? "text-muted-foreground"
                  : good
                    ? "text-status-completed"
                    : "text-status-overdue",
              )}
              aria-hidden
            />
            <span className="font-medium">
              {change > 0 ? "Up" : change < 0 ? "Down" : "Flat"} {Math.abs(Math.round(change * 100))}%
            </span>
            <span className="text-muted-foreground">vs previous period</span>
          </>
        )}
      </p>
    </div>
  );
}

function bucketLabel(g: Granularity, locale: string) {
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" });
  return (key: string) => (g === "month" ? month : day).format(new Date(`${key}T12:00:00Z`));
}

function LoadingState() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading analytics">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
