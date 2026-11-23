"use client";

import { useDroppable } from "@dnd-kit/core";
import type { JobDto, UserSummaryDto } from "@opsdesk/shared";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@opsdesk/ui/avatar";
import {
  assignLanes,
  DAY_END_HOUR,
  DAY_HEIGHT_PX,
  DAY_START_HOUR,
  geometry,
  HOUR_PX,
  minutesOfDay,
} from "@/lib/dispatch";
import { cn } from "@opsdesk/ui/utils";
import { DraggableJobCard } from "./job-card";
import type { DropPreview } from "./types";

interface DayViewProps {
  dayKey: string;
  todayKey: string;
  tz: string;
  technicians: UserSummaryDto[];
  jobs: JobDto[];
  preview: DropPreview | null;
  shakes: Record<string, number>;
  onOpen: (job: JobDto) => void;
}

const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

/** One column per technician; vertical position = time of day. */
export function DayView({ dayKey, todayKey, tz, technicians, jobs, preview, shakes, onOpen }: DayViewProps) {
  return (
    <div className="max-h-[calc(100dvh-15rem)] min-h-96 overflow-auto rounded-b-xl">
      <div
        className="grid min-w-fit"
        style={{ gridTemplateColumns: `3.5rem repeat(${technicians.length}, minmax(11rem, 1fr))` }}
      >
        {/* Header row */}
        <div className="sticky top-0 left-0 z-30 border-b bg-card" />
        {technicians.map((t) => (
          <div
            key={t.id}
            className="sticky top-0 z-20 flex items-center gap-2 border-b border-l bg-card px-3 py-2.5"
          >
            <Avatar name={t.name} src={t.avatarUrl} size="sm" />
            <span className="truncate text-sm font-medium">{t.name}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
              {jobs.filter((j) => j.technician?.id === t.id).length}
            </span>
          </div>
        ))}

        {/* Time gutter */}
        <div className="sticky left-0 z-10 bg-card" style={{ height: DAY_HEIGHT_PX }} aria-hidden>
          {HOURS.map((h) => (
            <div
              key={h}
              className="relative pr-2 text-right font-mono text-[11px] text-muted-foreground"
              style={{ height: HOUR_PX }}
            >
              <span className="relative -top-2">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {technicians.map((t) => (
          <TechColumn
            key={t.id}
            tech={t}
            dayKey={dayKey}
            tz={tz}
            jobs={jobs.filter((j) => j.technician?.id === t.id)}
            preview={preview?.targetId === `day:${t.id}` ? preview : null}
            showNow={dayKey === todayKey}
            shakes={shakes}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function TechColumn({
  tech,
  dayKey,
  tz,
  jobs,
  preview,
  showNow,
  shakes,
  onOpen,
}: {
  tech: UserSummaryDto;
  dayKey: string;
  tz: string;
  jobs: JobDto[];
  preview: DropPreview | null;
  showNow: boolean;
  shakes: Record<string, number>;
  onOpen: (job: JobDto) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${tech.id}` });
  const lanes = useMemo(
    () =>
      assignLanes(
        jobs.map((j) => ({
          id: j.id,
          start: Date.parse(j.scheduledStart ?? ""),
          end: Date.parse(j.scheduledEnd ?? ""),
        })),
      ),
    [jobs],
  );

  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label={`${tech.name}'s schedule`}
      className={cn(
        "relative border-l transition-colors duration-150",
        "bg-[repeating-linear-gradient(to_bottom,var(--border)_0,var(--border)_1px,transparent_1px,transparent_64px)]",
        isOver && (preview?.conflict ? "bg-destructive/5" : "bg-primary/5"),
      )}
      style={{ height: DAY_HEIGHT_PX }}
    >
      {jobs.map((j) => {
        if (!j.scheduledStart || !j.scheduledEnd) return null;
        const { top, height } = geometry(j.scheduledStart, j.scheduledEnd, dayKey, tz);
        const lane = lanes.get(j.id) ?? { lane: 0, lanes: 1 };
        const width = 100 / lane.lanes;
        return (
          <DraggableJobCard
            key={j.id}
            job={j}
            tz={tz}
            compact={height < 48}
            shakeKey={shakes[j.id]}
            onOpen={onOpen}
            className="absolute px-1"
            style={{ top, height, left: `${lane.lane * width}%`, width: `${width}%` }}
          />
        );
      })}

      {preview && <PreviewSlot preview={preview} dayKey={dayKey} tz={tz} />}
      {showNow && <NowLine tz={tz} />}
    </div>
  );
}

/** Dashed ghost showing exactly where (and when) the job will land. Red if it would clash. */
function PreviewSlot({ preview, dayKey, tz }: { preview: DropPreview; dayKey: string; tz: string }) {
  const { top, height } = geometry(preview.start, preview.end, dayKey, tz);
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 rounded-lg border-2 border-dashed px-2 py-1 text-[11px] font-medium",
        preview.conflict
          ? "border-destructive bg-destructive/10 text-destructive"
          : "border-primary bg-primary/10 text-primary",
      )}
      style={{ top, height }}
    >
      {preview.label}
    </div>
  );
}

function NowLine({ tz }: { tz: string }) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(t);
  }, []);
  const minutes = minutesOfDay(now, tz);
  if (minutes < DAY_START_HOUR * 60 || minutes > DAY_END_HOUR * 60) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-20 h-px bg-destructive"
      style={{ top: ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_PX }}
    >
      <span className="absolute -top-1 -left-1 size-2 rounded-full bg-destructive" />
    </div>
  );
}
