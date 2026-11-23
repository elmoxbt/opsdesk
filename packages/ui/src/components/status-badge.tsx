"use client";

import type { JobStatus } from "@opsdesk/shared";
import { AnimatePresence, motion } from "motion/react";
import { duration } from "../lib/motion";
import { cn } from "../lib/utils";

/** Job statuses plus the invoice/quote ones, so every status pill in the app looks the same. */
export type BadgeStatus =
  | JobStatus
  | "OVERDUE"
  | "DRAFT"
  | "SENT"
  | "PARTIALLY_PAID"
  | "VOID"
  | "ACCEPTED"
  | "DECLINED"
  | "CONVERTED";

const STATUS_STYLE: Record<BadgeStatus, { label: string; color: string }> = {
  REQUESTED: { label: "Requested", color: "var(--status-requested)" },
  SCHEDULED: { label: "Scheduled", color: "var(--status-scheduled)" },
  EN_ROUTE: { label: "En route", color: "var(--status-en-route)" },
  IN_PROGRESS: { label: "In progress", color: "var(--status-in-progress)" },
  COMPLETED: { label: "Completed", color: "var(--status-completed)" },
  INVOICED: { label: "Invoiced", color: "var(--status-completed)" },
  PAID: { label: "Paid", color: "var(--status-completed)" },
  CANCELLED: { label: "Cancelled", color: "var(--status-requested)" },
  OVERDUE: { label: "Overdue", color: "var(--status-overdue)" },
  DRAFT: { label: "Draft", color: "var(--status-requested)" },
  SENT: { label: "Sent", color: "var(--status-scheduled)" },
  PARTIALLY_PAID: { label: "Part paid", color: "var(--status-en-route)" },
  VOID: { label: "Void", color: "var(--status-requested)" },
  ACCEPTED: { label: "Accepted", color: "var(--status-completed)" },
  DECLINED: { label: "Declined", color: "var(--status-overdue)" },
  CONVERTED: { label: "Invoiced", color: "var(--status-in-progress)" },
};

/**
 * Status pill. On change, the old and new pills cross-fade in the same grid
 * cell (opacity only), instead of animating color, so no repaint-heavy properties move.
 */
export function StatusBadge({ status, className }: { status: BadgeStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cn("inline-grid", className)} role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.base }}
          className="col-start-1 row-start-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{
            color: s.color,
            backgroundColor: `color-mix(in oklch, ${s.color} var(--status-soft-mix), transparent)`,
          }}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
          {s.label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
