"use client";

import type { JobDto } from "@opsdesk/shared";
import { cn } from "@opsdesk/ui/utils";
import { Check } from "lucide-react";
import { useSync } from "@/offline/sync-provider";

/** Big tap targets; each tick is queued as an absolute "set done = X" (replay-safe, no conflicts). */
export function ChecklistSection({ job, editable }: { job: JobDto; editable: boolean }) {
  const { enqueue } = useSync();
  if (job.checklist.length === 0) return null;
  const done = job.checklist.filter((i) => i.done).length;
  return (
    <section aria-labelledby="checklist" className="rounded-2xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="checklist" className="font-semibold">
          Checklist
        </h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {done}/{job.checklist.length}
        </span>
      </div>
      <ul>
        {job.checklist.map((item) => (
          <li key={item.id}>
            <label
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-lg px-1",
                editable && "cursor-pointer active:bg-muted/60",
              )}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={item.done}
                disabled={!editable}
                onChange={(e) =>
                  void enqueue({
                    kind: "checklist",
                    jobId: job.id,
                    itemId: item.id,
                    label: item.label,
                    done: e.target.checked,
                  })
                }
              />
              <span
                aria-hidden
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-md border-2 transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2",
                  item.done ? "border-primary bg-primary text-primary-foreground" : "border-input",
                )}
              >
                {item.done && <Check className="size-4" strokeWidth={3} />}
              </span>
              <span className={cn("text-sm", item.done && "text-muted-foreground line-through")}>
                {item.label}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
