"use client";

import { formatJobNumber, type JobDto } from "@opsdesk/shared";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { cn } from "@opsdesk/ui/utils";
import { ArrowRight, CheckCircle2, CloudUpload, Navigation } from "lucide-react";
import { animate, motion, type PanInfo, useMotionValue, useTransform } from "motion/react";
import { useRef } from "react";
import Link from "next/link";
import { directionsUrl, type NextAction } from "@/lib/next-action";

const THRESHOLD = 96;

interface Props {
  job: JobDto;
  timeLabel: string;
  action: NextAction;
  pendingCount: number;
  onAction: () => void;
}

/**
 * Swipe right → the job's next step ("On my way", "Start", "Complete").
 * Swipe left → directions. The actions are revealed under the card and fire
 * past a threshold, with a light haptic tick. Tapping opens the job. The same
 * actions exist as buttons on the job page (and the action sheet), so nothing
 * depends on the gesture.
 */
export function SwipeJobCard({ job, timeLabel, action, pendingCount, onAction }: Props) {
  const x = useMotionValue(0);
  const rightOpacity = useTransform(x, [0, THRESHOLD], [0, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, 0], [1, 0]);
  const done = job.status === "COMPLETED";
  // The pointer-up that ends a swipe would otherwise also "click" the card's link.
  const dragged = useRef(false);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > THRESHOLD && action) {
      navigator.vibrate?.(10);
      onAction();
    } else if (info.offset.x < -THRESHOLD && job.customer.address) {
      navigator.vibrate?.(10);
      window.open(directionsUrl(job.customer.address), "_blank", "noopener");
    }
    void animate(x, 0, { type: "spring", stiffness: 500, damping: 40 });
  };

  return (
    <div className="no-select relative overflow-hidden rounded-2xl">
      {action && (
        <motion.div
          style={{ opacity: rightOpacity }}
          className="absolute inset-0 flex items-center gap-2 bg-primary pl-5 text-sm font-semibold text-primary-foreground"
          aria-hidden
        >
          {action.type === "complete" ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <ArrowRight className="size-5" />
          )}
          {action.short}
        </motion.div>
      )}
      {job.customer.address && (
        <motion.div
          style={{ opacity: leftOpacity }}
          className="absolute inset-0 flex items-center justify-end gap-2 bg-status-scheduled pr-5 text-sm font-semibold text-white"
          aria-hidden
        >
          Directions
          <Navigation className="size-5" />
        </motion.div>
      )}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: job.customer.address ? 0.55 : 0.05, right: action ? 0.55 : 0.05 }}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={onDragEnd}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
            dragged.current = false;
          }
        }}
        style={{ x }}
        className={cn("relative rounded-2xl border bg-card shadow-xs", done && "opacity-70")}
      >
        <Link
          href={`/job?id=${job.id}`}
          className="block rounded-2xl p-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          draggable={false}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground tabular-nums">{timeLabel}</p>
              <p className="mt-0.5 truncate text-base font-semibold">{job.customer.name}</p>
              <p className="truncate text-sm text-muted-foreground">{job.serviceType.name}</p>
            </div>
            <StatusBadge status={job.status} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{job.customer.address ?? "No address"}</span>
            <span className="flex shrink-0 items-center gap-2">
              {pendingCount > 0 && (
                <span className="inline-flex items-center gap-1 text-primary" title="Changes waiting to sync">
                  <CloudUpload className="size-3.5" aria-hidden />
                  <span className="sr-only">Waiting to sync:</span>
                  {pendingCount}
                </span>
              )}
              <span className="font-mono">{formatJobNumber(job.number)}</span>
            </span>
          </div>
        </Link>
      </motion.div>
    </div>
  );
}
