"use client";

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  DragOverlay,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  findConflicts,
  formatJobNumber,
  type JobDto,
  type UserSummaryDto,
  zonedDateKey,
} from "@opsdesk/shared";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TeamIllustration } from "@opsdesk/ui/illustrations";
import { LiveIndicator } from "@/components/realtime-provider";
import { Button } from "@opsdesk/ui/button";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { useSession } from "@/hooks/use-session";
import { useUrlState } from "@/hooks/use-url-state";
import { errorMessage } from "@/lib/api/client";
import { useBoard, useScheduleJob } from "@/lib/api/hooks";
import { addDays, rangeFor, sameTimeOnDay, startFromOffset, startOfWeek, weekDays } from "@/lib/dispatch";
import { formatTimeRange } from "@/lib/format";
import { cn } from "@opsdesk/ui/utils";
import { DayView } from "./day-view";
import { JobCardView } from "./job-card";
import { RescheduleDialog } from "./reschedule-dialog";
import type { DropPreview } from "./types";
import { UnscheduledTray } from "./unscheduled-tray";
import { WeekView } from "./week-view";
import { PageTitle } from "@opsdesk/ui/page-title";

const KEYS = ["view", "date"] as const;

/** Lands with a slight overshoot, like a gentle spring. Transform/opacity only. */
const DROP_ANIMATION: DropAnimation = {
  duration: 280,
  easing: "cubic-bezier(0.2, 0.9, 0.3, 1.15)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } }),
};

const durationMinutes = (j: JobDto) =>
  j.scheduledStart && j.scheduledEnd
    ? (Date.parse(j.scheduledEnd) - Date.parse(j.scheduledStart)) / 60_000
    : j.serviceType.defaultDurationMinutes;

export function DispatchBoard() {
  const { organization } = useSession();
  const tz = organization.timezone;
  const reduceMotion = useReducedMotion();
  const [url, setUrl] = useUrlState(KEYS);
  const todayKey = zonedDateKey(new Date(), tz);
  const view = url.view === "week" ? "week" : "day";
  const date = url.date && /^\d{4}-\d{2}-\d{2}$/.test(url.date) ? url.date : todayKey;
  const range = useMemo(() => rangeFor(view, date, tz), [view, date, tz]);

  const board = useBoard(range);
  const schedule = useScheduleJob(range);
  const [active, setActive] = useState<JobDto | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const [shakes, setShakes] = useState<Record<string, number>>({});
  const [dialogJob, setDialogJob] = useState<JobDto | null>(null);
  const [dialogError, setDialogError] = useState<{ message: string } | null>(null);
  const previewKey = useRef("");

  const sensors = useSensors(
    // A few pixels of movement before a drag starts, so a click still opens the dialog.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch: press-and-hold, so swiping still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const techById = useMemo(
    () => new Map((board.data?.technicians ?? []).map((t) => [t.id, t])),
    [board.data],
  );

  const shake = useCallback((id: string) => setShakes((s) => ({ ...s, [id]: Date.now() })), []);

  /** Where would the dragged card land, and would it clash? Pure function of the drag event. */
  const resolve = useCallback(
    (e: DragMoveEvent | DragEndEvent): DropPreview | null => {
      const job = e.active.data.current?.job as JobDto | undefined;
      const over = e.over;
      if (!job || !over || !board.data) return null;
      const overId = String(over.id);
      const minutes = durationMinutes(job);
      let technicianId: string;
      let start: Date;
      if (overId.startsWith("day:")) {
        const top = e.active.rect.current.translated?.top;
        if (top === undefined) return null;
        technicianId = overId.slice(4);
        start = startFromOffset(date, top - over.rect.top, minutes, tz);
      } else if (overId.startsWith("week:")) {
        const [, tech = "", day = ""] = overId.split(":");
        technicianId = tech;
        start = sameTimeOnDay(job.scheduledStart, day, tz);
      } else return null;
      const end = new Date(start.getTime() + minutes * 60_000);
      const clashes = findConflicts(
        { id: job.id, technicianId, start, end },
        board.data.jobs.map((j) => ({ ...j, technicianId: j.technician?.id ?? null })),
      );
      return {
        targetId: overId,
        technicianId,
        start: start.toISOString(),
        end: end.toISOString(),
        conflict: clashes.length > 0,
        label: clashes.length
          ? `Clashes with ${formatJobNumber(clashes[0]!.number)}`
          : (formatTimeRange(start.toISOString(), end.toISOString(), tz).split(", ").pop() ?? ""),
      };
    },
    [board.data, date, tz],
  );

  const commit = useCallback(
    (job: JobDto, technician: UserSummaryDto, start: string, end: string, fromDialog = false) => {
      if (job.technician?.id === technician.id && job.scheduledStart === start) return;
      schedule.mutate(
        { job, technician, scheduledStart: start, scheduledEnd: end },
        {
          onSuccess: (saved) => {
            toast.success(
              `${formatJobNumber(saved.number)} → ${technician.name}, ${formatTimeRange(saved.scheduledStart, saved.scheduledEnd, tz)}`,
            );
            if (fromDialog) setDialogJob(null);
          },
          onError: (err) => {
            shake(job.id);
            const message = errorMessage(err);
            if (fromDialog) setDialogError({ message });
            else toast.error(message);
          },
        },
      );
    },
    [schedule, shake, tz],
  );

  const onDragStart = (e: DragStartEvent) =>
    setActive((e.active.data.current?.job as JobDto | undefined) ?? null);
  const onDragMove = (e: DragMoveEvent) => {
    const p = resolve(e);
    const key = p ? `${p.targetId}|${p.start}|${p.conflict}` : "";
    if (key !== previewKey.current) {
      previewKey.current = key;
      setPreview(p);
    }
  };
  const onDragEnd = (e: DragEndEvent) => {
    const job = e.active.data.current?.job as JobDto | undefined;
    const p = resolve(e);
    setActive(null);
    setPreview(null);
    previewKey.current = "";
    if (!job || !p) return;
    const technician = techById.get(p.technicianId);
    if (!technician) return;
    if (p.conflict) {
      // Caught client-side: don't even send it. (The server re-checks anyway.)
      shake(job.id);
      toast.error(`${technician.name} is already booked then. ${p.label}.`);
      return;
    }
    commit(job, technician, p.start, p.end);
  };

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${describe(a.data.current?.job as JobDto | undefined)}.`,
    onDragOver: ({ over }) =>
      over ? `Over ${targetName(String(over.id), techById)}.` : "Not over a drop target.",
    onDragEnd: ({ over }) =>
      over ? `Dropped on ${targetName(String(over.id), techById)}.` : "Dropped outside the board. No change.",
    onDragCancel: () => "Move cancelled. No change.",
  };

  const shift = (dir: -1 | 1) =>
    setUrl({ date: addDays(date, dir * (view === "week" ? 7 : 1)) }, { resetPage: false });
  const title =
    view === "day"
      ? new Intl.DateTimeFormat("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(new Date(`${date}T12:00:00Z`))
      : weekTitle(date);

  return (
    <div className="space-y-4">
      <PageTitle>Dispatch</PageTitle>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dispatch</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Info className="size-3.5" aria-hidden /> Drag jobs to schedule or reassign. Click or press Enter
            on a job to reschedule it.
          </p>
        </div>
        <LiveIndicator />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="inline-flex rounded-lg border bg-card p-0.5 shadow-xs">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setUrl({ view: v === "day" ? undefined : v }, { resetPage: false })}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors duration-150",
                view === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={view === "week" ? "Previous week" : "Previous day"}
            onClick={() => shift(-1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            onClick={() => setUrl({ date: undefined }, { resetPage: false })}
            disabled={date === todayKey}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={view === "week" ? "Next week" : "Next day"}
            onClick={() => shift(1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <h2 className="ml-1 text-base font-semibold" aria-live="polite">
          {title}
        </h2>
      </div>

      {board.isPending ? (
        <BoardSkeleton />
      ) : board.isError ? (
        <div className="rounded-xl border bg-card">
          <ErrorState message={errorMessage(board.error)} onRetry={() => void board.refetch()} />
        </div>
      ) : board.data.technicians.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            illustration={TeamIllustration}
            title="No technicians yet"
            description="Invite technicians from the Team page, then schedule their jobs here."
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActive(null);
            setPreview(null);
          }}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "Drag with a mouse or touch. Keyboard users: press Enter to open the reschedule dialog.",
            },
          }}
        >
          <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
            <UnscheduledTray jobs={board.data.unscheduled} tz={tz} shakes={shakes} onOpen={openDialog} />
            <div
              className={cn(
                "min-w-0 rounded-xl border bg-card shadow-sm transition-opacity",
                board.isPlaceholderData && "opacity-60",
              )}
            >
              {view === "day" ? (
                <DayView
                  dayKey={date}
                  todayKey={todayKey}
                  tz={tz}
                  technicians={board.data.technicians}
                  jobs={board.data.jobs}
                  preview={preview}
                  shakes={shakes}
                  onOpen={openDialog}
                />
              ) : (
                <WeekView
                  anchorKey={date}
                  todayKey={todayKey}
                  tz={tz}
                  technicians={board.data.technicians}
                  jobs={board.data.jobs}
                  preview={preview}
                  shakes={shakes}
                  onOpen={openDialog}
                />
              )}
            </div>
          </div>
          <DragOverlay dropAnimation={reduceMotion ? null : DROP_ANIMATION}>
            {active && (
              <motion.div
                initial={{ scale: 1 }}
                animate={{ scale: 1.02 }}
                transition={{ duration: 0.15 }}
                className="w-56 cursor-grabbing"
              >
                <JobCardView job={active} tz={tz} lifted />
              </motion.div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      <RescheduleDialog
        job={dialogJob}
        technicians={board.data?.technicians ?? []}
        tz={tz}
        pending={schedule.isPending}
        error={dialogError}
        onClose={() => setDialogJob(null)}
        onSubmit={(technician, startIso) => {
          if (!dialogJob) return;
          const end = new Date(Date.parse(startIso) + durationMinutes(dialogJob) * 60_000).toISOString();
          setDialogError(null);
          commit(dialogJob, technician, startIso, end, true);
        }}
      />
    </div>
  );

  function openDialog(job: JobDto) {
    setDialogError(null);
    setDialogJob(job);
  }
}

function describe(job: JobDto | undefined): string {
  return job ? `${formatJobNumber(job.number)} for ${job.customer.name}` : "job";
}

function targetName(id: string, techs: Map<string, UserSummaryDto>): string {
  const [, techId = "", day] = id.split(":");
  const name = techs.get(techId)?.name ?? "technician";
  return day ? `${name} on ${day}` : `${name}'s column`;
}

function weekTitle(key: string): string {
  const days = weekDays(startOfWeek(key));
  const fmt = (k: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));
  return `${fmt(days[0]!, { day: "numeric", month: "short" })} – ${fmt(days[6]!, { day: "numeric", month: "short", year: "numeric" })}`;
}

function BoardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]" aria-busy="true" aria-label="Loading board">
      <Skeleton className="h-64 rounded-xl" />
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 flex-1" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
