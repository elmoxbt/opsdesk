"use client";

import type { JobStatus } from "@opsdesk/shared";
import { cn } from "@opsdesk/ui/utils";

const FILTERABLE: Array<{ value: JobStatus; label: string; color: string }> = [
  { value: "REQUESTED", label: "Requested", color: "var(--status-requested)" },
  { value: "SCHEDULED", label: "Scheduled", color: "var(--status-scheduled)" },
  { value: "EN_ROUTE", label: "En route", color: "var(--status-en-route)" },
  { value: "IN_PROGRESS", label: "In progress", color: "var(--status-in-progress)" },
  { value: "COMPLETED", label: "Completed", color: "var(--status-completed)" },
  { value: "CANCELLED", label: "Cancelled", color: "var(--status-requested)" },
];

/** Toggle chips (aria-pressed) for multi-select status filtering. */
export function StatusFilter({
  value,
  onChange,
}: {
  value: JobStatus[];
  onChange: (v: JobStatus[]) => void;
}) {
  return (
    <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
      {FILTERABLE.map((s) => {
        const on = value.includes(s.value);
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== s.value) : [...value, s.value])}
            className={cn(
              "motion-press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-[transform,background-color,border-color] duration-150 active:scale-[0.98]",
              on
                ? "border-transparent text-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            style={
              on
                ? { backgroundColor: `color-mix(in oklch, ${s.color} var(--status-soft-mix), transparent)` }
                : undefined
            }
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
