"use client";

import { useDraggable } from "@dnd-kit/core";
import { formatJobNumber, type JobDto } from "@opsdesk/shared";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { usePulse } from "@/components/realtime-provider";
import { formatTimeRange } from "@/lib/format";
import { cn } from "@opsdesk/ui/utils";

const STATUS_COLOR: Record<string, string> = {
  REQUESTED: "var(--status-requested)",
  SCHEDULED: "var(--status-scheduled)",
  EN_ROUTE: "var(--status-en-route)",
  IN_PROGRESS: "var(--status-in-progress)",
  COMPLETED: "var(--status-completed)",
  INVOICED: "var(--status-completed)",
  PAID: "var(--status-completed)",
  CANCELLED: "var(--status-requested)",
};

/** Only REQUESTED/SCHEDULED jobs can be moved; others show but don't drag. */
export const isMovable = (job: JobDto) => job.status === "REQUESTED" || job.status === "SCHEDULED";

interface CardViewProps {
  job: JobDto;
  tz: string;
  compact?: boolean;
  lifted?: boolean;
  className?: string;
}

/** Presentational card, shared by the grid, the tray and the drag overlay. */
export function JobCardView({ job, tz, compact, lifted, className }: CardViewProps) {
  const color = STATUS_COLOR[job.status];
  return (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-lg border bg-card px-2.5 py-1.5 text-left text-xs shadow-xs",
        lifted && "shadow-lg ring-1 ring-primary/30",
        className,
      )}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: color,
        backgroundColor: `color-mix(in oklch, ${color} 7%, var(--card))`,
      }}
    >
      <p className="flex items-center gap-1.5 truncate font-medium text-foreground">
        <span className="truncate">{job.customer.name}</span>
        {job.source === "BOOKING" && <OnlineBadge />}
      </p>
      <p className="truncate text-muted-foreground">{job.serviceType.name}</p>
      {!compact && (
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {job.scheduledStart
            ? formatTimeRange(job.scheduledStart, job.scheduledEnd, tz).split(", ")[1]
            : formatJobNumber(job.number)}
        </p>
      )}
    </div>
  );
}

interface DraggableCardProps extends CardViewProps {
  style?: CSSProperties;
  shakeKey?: number;
  onOpen: (job: JobDto) => void;
}

/**
 * A board card: draggable with pointer/touch (dnd-kit), and a real <button> so
 * keyboard and screen-reader users open the reschedule dialog instead of dragging.
 */
export function DraggableJobCard({
  job,
  tz,
  compact,
  style,
  shakeKey,
  onOpen,
  className,
}: DraggableCardProps) {
  const movable = isMovable(job);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: job.id,
    data: { job },
    disabled: !movable,
  });
  const pulse = usePulse(job.id);
  const label = `${formatJobNumber(job.number)}, ${job.customer.name}, ${job.serviceType.name}${
    job.scheduledStart ? `, ${formatTimeRange(job.scheduledStart, job.scheduledEnd, tz)}` : ""
  }. ${movable ? "Press Enter to reschedule." : "Open job."}`;

  return (
    <motion.div
      // Re-keying replays the shake each time a drop is rejected.
      key={shakeKey ?? "still"}
      animate={shakeKey ? { x: [0, -6, 6, -4, 4, 0] } : undefined}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn("group", className)}
      style={style}
    >
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        {...attributes}
        // No dnd-kit keyboard sensor: Enter/Space trigger onClick, which opens the reschedule dialog.
        aria-roledescription={movable ? "draggable job" : "job"}
        aria-label={label}
        onClick={() => onOpen(job)}
        className={cn(
          "relative block h-full w-full rounded-lg transition-[opacity,box-shadow] duration-150 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-1",
          movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          isDragging && "opacity-30",
        )}
      >
        <JobCardView job={job} tz={tz} compact={compact} />
        {pulse && (
          <motion.span
            key={pulse}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-primary"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.2, 1, 0] }}
            transition={{ duration: 1.4, ease: "easeInOut" }}
          />
        )}
        {shakeKey && (
          <motion.span
            key={`err-${shakeKey}`}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg bg-destructive/15 ring-2 ring-destructive"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1, delay: 0.3 }}
          />
        )}
      </button>
    </motion.div>
  );
}

/** Marks jobs that came in through the public booking page. */
export function OnlineBadge() {
  return (
    <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[10px] font-semibold tracking-wide text-primary uppercase">
      Online
    </span>
  );
}
