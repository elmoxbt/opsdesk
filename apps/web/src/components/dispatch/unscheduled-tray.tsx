"use client";

import type { JobDto } from "@opsdesk/shared";
import { CheckCircle2 } from "lucide-react";
import { DraggableJobCard } from "./job-card";

/** Requested jobs waiting for a technician/time. Drag onto the board, or click to schedule. */
export function UnscheduledTray({
  jobs,
  tz,
  shakes,
  onOpen,
}: {
  jobs: JobDto[];
  tz: string;
  shakes: Record<string, number>;
  onOpen: (job: JobDto) => void;
}) {
  return (
    <section aria-labelledby="tray-title" className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 id="tray-title" className="text-sm font-semibold">
          To schedule
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs tabular-nums">
          {jobs.length}
        </span>
      </div>
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="size-6 text-status-completed" aria-hidden />
          Every request is scheduled.
        </div>
      ) : (
        <ul className="max-h-[calc(100dvh-20rem)] space-y-2 overflow-y-auto p-3">
          {jobs.map((j) => (
            <li key={j.id}>
              <DraggableJobCard job={j} tz={tz} shakeKey={shakes[j.id]} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
