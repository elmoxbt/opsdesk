"use client";

import {
  api,
  type JobDto,
  type Paginated,
  TRANSITION_DONE,
  zonedDateKey,
  zonedDayRange,
} from "@opsdesk/shared";
import { Avatar } from "@opsdesk/ui/avatar";
import { BottomSheet } from "@opsdesk/ui/bottom-sheet";
import { Button } from "@opsdesk/ui/button";
import { JobsIllustration } from "@opsdesk/ui/illustrations";
import { Logo } from "@opsdesk/ui/logo";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { ThemeToggle } from "@opsdesk/ui/theme-toggle";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { SwipeJobCard } from "@/components/swipe-job-card";
import { SyncPill } from "@/components/sync-pill";
import { nextAction } from "@/lib/next-action";
import { useSession } from "@/lib/session";
import { applyPending, pendingFor } from "@/offline/overlay";
import { useSync } from "@/offline/sync-provider";

export default function HomePage() {
  return (
    <AuthGate>
      <Today />
    </AuthGate>
  );
}

const time = (iso: string | null, tz: string) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(
        new Date(iso),
      )
    : "--:--";
const dayHeading = (key: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${key}T12:00:00Z`));

function Today() {
  const me = useSession();
  const tz = me.organization.timezone;
  const router = useRouter();
  const qc = useQueryClient();
  const { entries, enqueue, flush } = useSync();
  const [menu, setMenu] = useState(false);

  const todayKey = zonedDateKey(new Date(), tz);
  const range = useMemo(() => {
    const { start } = zonedDayRange(new Date(), tz);
    return { from: start.toISOString(), to: new Date(start.getTime() + 7 * 86_400_000).toISOString() };
  }, [tz]);

  // Under way (any date) + the next 7 days. Both are persisted for offline use.
  const active = useQuery({
    queryKey: ["jobs", "active"],
    queryFn: () =>
      api<Paginated<JobDto>>("/jobs", {
        query: { status: "EN_ROUTE,IN_PROGRESS", sort: "scheduledStart", pageSize: 50 },
      }),
  });
  const upcoming = useQuery({
    queryKey: ["jobs", "upcoming", todayKey],
    queryFn: () =>
      api<Paginated<JobDto>>("/jobs", {
        query: { status: "SCHEDULED,COMPLETED", ...range, sort: "scheduledStart", pageSize: 100 },
      }),
  });

  const groups = useMemo(() => {
    const byId = new Map<string, JobDto>();
    for (const j of [...(active.data?.items ?? []), ...(upcoming.data?.items ?? [])]) byId.set(j.id, j);
    const jobs = [...byId.values()].map((j) => ({ server: j, view: applyPending(j, entries) }));
    const now = jobs.filter((j) => j.view.status === "EN_ROUTE" || j.view.status === "IN_PROGRESS");
    const rest = jobs.filter((j) => !now.includes(j));
    const days = new Map<string, typeof jobs>();
    for (const j of rest) {
      const key = j.view.scheduledStart ? zonedDateKey(new Date(j.view.scheduledStart), tz) : todayKey;
      days.set(key, [...(days.get(key) ?? []), j]);
    }
    return { now, days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)) };
  }, [active.data, upcoming.data, entries, tz, todayKey]);

  const loading = (active.isPending || upcoming.isPending) && !active.data && !upcoming.data;
  const failed = active.isError && upcoming.isError && !active.data && !upcoming.data;

  const act = async (server: JobDto, view: JobDto) => {
    const a = nextAction(view.status);
    if (!a) return;
    if (a.type === "complete") return router.push(`/job?id=${server.id}&complete=1`);
    await enqueue({ kind: "transition", jobId: server.id, to: a.to, version: server.version });
    toast.success(TRANSITION_DONE[a.to], { description: server.customer.name });
  };

  const card = ({ server, view }: { server: JobDto; view: JobDto }, i: number) => (
    <motion.li
      key={server.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 10) * 0.03 }}
    >
      <SwipeJobCard
        job={view}
        timeLabel={`${time(view.scheduledStart, tz)}–${time(view.scheduledEnd, tz)}`}
        action={nextAction(view.status)}
        pendingCount={pendingFor(server.id, entries).length}
        onAction={() => void act(server, view)}
      />
    </motion.li>
  );

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/85 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 backdrop-blur">
        <Logo withText={false} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-tight font-semibold">My jobs</h1>
          <p className="text-xs text-muted-foreground">{dayHeading(todayKey)}</p>
        </div>
        <SyncPill
          jobNumbers={Object.fromEntries(
            groups.now.concat(groups.days.flatMap(([, d]) => d)).map((j) => [j.server.id, j.server.number]),
          )}
        />
        <button
          type="button"
          onClick={() => setMenu(true)}
          className="rounded-full"
          aria-label="Account and settings"
        >
          <Avatar name={me.name} size="sm" />
        </button>
      </header>

      <PullToRefresh onRefresh={() => Promise.all([qc.refetchQueries({ queryKey: ["jobs"] }), flush()])}>
        <main className="space-y-6 px-4 pt-4">
          {loading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading jobs">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </div>
          ) : failed ? (
            <ErrorState
              message="Couldn't load your jobs. Pull down to try again."
              onRetry={() => void qc.refetchQueries({ queryKey: ["jobs"] })}
            />
          ) : groups.now.length === 0 && groups.days.length === 0 ? (
            <EmptyState
              illustration={JobsIllustration}
              title="Nothing scheduled"
              description="New jobs appear here as soon as the office assigns them."
            />
          ) : (
            <>
              {groups.now.length > 0 && (
                <section aria-labelledby="now">
                  <h2 id="now" className="mb-2 text-xs font-semibold tracking-wide text-primary uppercase">
                    Under way
                  </h2>
                  <ul className="space-y-3">{groups.now.map(card)}</ul>
                </section>
              )}
              {groups.days.map(([key, jobs]) => (
                <section key={key} aria-labelledby={`d-${key}`}>
                  <h2
                    id={`d-${key}`}
                    className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    {key === todayKey ? "Today" : dayHeading(key)}
                  </h2>
                  <ul className="space-y-3">{jobs.map(card)}</ul>
                </section>
              ))}
              <p className="pt-2 text-center text-xs text-muted-foreground">
                Swipe right for the next step · left for directions
              </p>
            </>
          )}
        </main>
      </PullToRefresh>

      <BottomSheet
        open={menu}
        onOpenChange={setMenu}
        title={me.name}
        description={`${me.email} · ${me.organization.name}`}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Theme</span>
            <ThemeToggle />
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              await api("/auth/logout", { method: "POST" }).catch(() => undefined);
              qc.clear();
              router.replace("/login");
            }}
          >
            Sign out
          </Button>
          <p className="text-xs text-muted-foreground">
            Changes waiting to sync stay on this device and are sent the next time you sign in here.
          </p>
        </div>
      </BottomSheet>
    </div>
  );
}
