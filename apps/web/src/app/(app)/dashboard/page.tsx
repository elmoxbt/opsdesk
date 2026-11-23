"use client";

import { formatJobNumber, type JobDto, zonedDayRange } from "@opsdesk/shared";
import { AlertCircle, CalendarClock, CheckCircle2, Hammer, type LucideIcon, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { JobsIllustration } from "@opsdesk/ui/illustrations";
import { CountUp } from "@opsdesk/ui/count-up";
import { Avatar } from "@opsdesk/ui/avatar";
import { Button } from "@opsdesk/ui/button";
import { Card, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { AnimatedItem, useFirstLoad } from "@opsdesk/ui/table";
import { canManage, useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import { useJobs, useJobStats } from "@/lib/api/hooks";
import { formatTimeRange } from "@/lib/format";
import { PageTitle } from "@opsdesk/ui/page-title";

function greeting(timeZone: string): string {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date()),
  );
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const user = useSession();
  const manager = canManage(user);
  const tz = user.organization.timezone;
  const today = useMemo(() => zonedDayRange(new Date(), tz), [tz]);
  const stats = useJobStats();
  const todays = useJobs({
    from: today.start.toISOString(),
    to: today.end.toISOString(),
    status: ["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"],
    sort: "scheduledStart",
    pageSize: 50,
  });
  const unscheduled = useJobs({ status: ["REQUESTED"], sort: "-createdAt", pageSize: 5 });

  const kpis: Array<{ label: string; value: number | undefined; icon: LucideIcon; href: string }> = [
    {
      label: "Scheduled today",
      value: stats.data?.scheduledToday,
      icon: CalendarClock,
      href: "/jobs?sort=scheduledStart&status=SCHEDULED",
    },
    {
      label: "In progress",
      value: stats.data && stats.data.byStatus.EN_ROUTE + stats.data.byStatus.IN_PROGRESS,
      icon: Hammer,
      href: "/jobs?status=EN_ROUTE,IN_PROGRESS",
    },
    {
      label: "Needs scheduling",
      value: stats.data?.byStatus.REQUESTED,
      icon: AlertCircle,
      href: "/jobs?status=REQUESTED",
    },
    {
      label: "Completed, not invoiced",
      value: stats.data?.byStatus.COMPLETED,
      icon: CheckCircle2,
      href: "/jobs?status=COMPLETED",
    },
  ];

  return (
    <div className="space-y-8">
      <PageTitle>Dashboard</PageTitle>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(tz)}, {user.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "full" }).format(new Date())} ·{" "}
            {user.organization.name}
          </p>
        </div>
        {manager && (
          <Button asChild>
            <Link href="/jobs">
              <Plus aria-hidden /> New job
            </Link>
          </Button>
        )}
      </div>

      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="group rounded-xl border bg-card p-5 shadow-sm transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              {label}
              <Icon className="size-4 transition-colors group-hover:text-primary" aria-hidden />
            </div>
            {value === undefined ? (
              stats.isError ? (
                <p className="mt-2 text-2xl font-semibold">—</p>
              ) : (
                <Skeleton className="mt-3 h-7 w-12" />
              )
            ) : (
              <CountUp
                value={value}
                format={{ maximumFractionDigits: 0 }}
                className="mt-2 block text-3xl font-semibold"
              />
            )}
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Today&apos;s schedule</CardTitle>
            <Link
              href="/jobs?sort=scheduledStart"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View all
            </Link>
          </CardHeader>
          <JobList
            query={todays}
            tz={tz}
            empty={{
              title: "Nothing scheduled today",
              description: manager
                ? "Schedule a requested job, or create a new one."
                : "Enjoy the quiet. New assignments show up here.",
            }}
          />
        </Card>
        {manager && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Needs scheduling</CardTitle>
              {stats.data && stats.data.byStatus.REQUESTED > 5 && (
                <Link
                  href="/jobs?status=REQUESTED"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  All {stats.data.byStatus.REQUESTED}
                </Link>
              )}
            </CardHeader>
            <JobList
              query={unscheduled}
              tz={tz}
              compact
              empty={{ title: "All caught up", description: "Every request has a technician and a time." }}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function JobList({
  query,
  tz,
  compact,
  empty,
}: {
  query: ReturnType<typeof useJobs>;
  tz: string;
  compact?: boolean;
  empty: { title: string; description: string };
}) {
  const animate = useFirstLoad(query.isSuccess);
  if (query.isPending) {
    return (
      <div className="space-y-3 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (query.isError)
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (query.data.items.length === 0)
    return <EmptyState illustration={JobsIllustration} {...empty} className="py-8" />;
  return (
    <ul className="divide-y">
      {query.data.items.map((j: JobDto, i: number) => (
        <AnimatedItem key={j.id} index={i} animate={animate}>
          <Link
            href={`/jobs/${j.id}`}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50"
          >
            {!compact && (
              <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {formatTimeRange(j.scheduledStart, j.scheduledEnd, tz).split(", ")[1] ?? "—"}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{j.customer.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {formatJobNumber(j.number)} · {j.serviceType.name}
              </p>
            </div>
            {!compact && j.technician && (
              <Avatar name={j.technician.name} src={j.technician.avatarUrl} size="sm" />
            )}
            <StatusBadge status={j.status} />
          </Link>
        </AnimatedItem>
      ))}
    </ul>
  );
}
