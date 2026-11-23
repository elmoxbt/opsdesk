"use client";

import { useDroppable } from "@dnd-kit/core";
import type { JobDto, UserSummaryDto } from "@opsdesk/shared";
import { Avatar } from "@opsdesk/ui/avatar";
import { dayKeyOf, weekDays } from "@/lib/dispatch";
import { cn } from "@opsdesk/ui/utils";
import { DraggableJobCard } from "./job-card";
import type { DropPreview } from "./types";

interface WeekViewProps {
  anchorKey: string;
  todayKey: string;
  tz: string;
  technicians: UserSummaryDto[];
  jobs: JobDto[];
  preview: DropPreview | null;
  shakes: Record<string, number>;
  onOpen: (job: JobDto) => void;
}

const dayLabel = (key: string) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date),
    day: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date),
  };
};

/** One row per technician, one column per day. Moving a card keeps its time of day. */
export function WeekView({
  anchorKey,
  todayKey,
  tz,
  technicians,
  jobs,
  preview,
  shakes,
  onOpen,
}: WeekViewProps) {
  const days = weekDays(anchorKey);
  return (
    <div className="max-h-[calc(100dvh-15rem)] min-h-96 overflow-auto rounded-b-xl">
      <div className="grid min-w-fit" style={{ gridTemplateColumns: `11rem repeat(7, minmax(9rem, 1fr))` }}>
        <div className="sticky top-0 left-0 z-30 border-b bg-card" />
        {days.map((d) => {
          const { weekday, day } = dayLabel(d);
          return (
            <div
              key={d}
              className={cn(
                "sticky top-0 z-20 border-b border-l bg-card px-3 py-2",
                d === todayKey && "text-primary",
              )}
            >
              <p className="text-xs font-medium tracking-wide uppercase">{weekday}</p>
              <p className="text-sm font-semibold">{day}</p>
            </div>
          );
        })}

        {technicians.map((t) => (
          <Row
            key={t.id}
            tech={t}
            days={days}
            todayKey={todayKey}
            tz={tz}
            jobs={jobs.filter((j) => j.technician?.id === t.id)}
            preview={preview}
            shakes={shakes}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  tech,
  days,
  todayKey,
  tz,
  jobs,
  preview,
  shakes,
  onOpen,
}: {
  tech: UserSummaryDto;
  days: string[];
  todayKey: string;
  tz: string;
  jobs: JobDto[];
  preview: DropPreview | null;
  shakes: Record<string, number>;
  onOpen: (job: JobDto) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 flex items-start gap-2 border-b bg-card px-3 py-3">
        <Avatar name={tech.name} src={tech.avatarUrl} size="sm" />
        <span className="truncate pt-1 text-sm font-medium">{tech.name}</span>
      </div>
      {days.map((d) => (
        <Cell
          key={d}
          id={`week:${tech.id}:${d}`}
          isToday={d === todayKey}
          preview={preview?.targetId === `week:${tech.id}:${d}` ? preview : null}
          label={`${tech.name}, ${d}`}
        >
          {jobs
            .filter((j) => j.scheduledStart && dayKeyOf(j.scheduledStart, tz) === d)
            .map((j) => (
              <DraggableJobCard key={j.id} job={j} tz={tz} shakeKey={shakes[j.id]} onOpen={onOpen} />
            ))}
        </Cell>
      ))}
    </>
  );
}

function Cell({
  id,
  isToday,
  preview,
  label,
  children,
}: {
  id: string;
  isToday: boolean;
  preview: DropPreview | null;
  label: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label={label}
      className={cn(
        "min-h-24 space-y-1.5 border-b border-l p-1.5 transition-colors duration-150",
        isToday && "bg-primary/[0.03]",
        isOver && (preview?.conflict ? "bg-destructive/10" : "bg-primary/10"),
      )}
    >
      {children}
      {preview && (
        <div
          aria-hidden
          className={cn(
            "rounded-lg border-2 border-dashed px-2 py-1 text-[11px] font-medium",
            preview.conflict ? "border-destructive text-destructive" : "border-primary text-primary",
          )}
        >
          {preview.label}
        </div>
      )}
    </div>
  );
}
