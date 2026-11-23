"use client";

import { formatJobNumber } from "@opsdesk/shared";
import { BottomSheet } from "@opsdesk/ui/bottom-sheet";
import { Button } from "@opsdesk/ui/button";
import { cn } from "@opsdesk/ui/utils";
import { AlertTriangle, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSync } from "@/offline/sync-provider";
import type { OutboxEntry } from "@/offline/types";

const DESCRIBE: Record<OutboxEntry["kind"], string> = {
  transition: "Status change",
  checklist: "Checklist tick",
  addPart: "Part used",
  removePart: "Part removed",
  photo: "Photo",
  complete: "Job completion",
};

/**
 * Always-visible sync status: invisible when everything's synced; "Offline ·
 * 3 waiting"; "Syncing…"; or a red "Needs attention" that opens the list of
 * changes the server couldn't apply, with Retry/Discard for each.
 */
export function SyncPill({ jobNumbers }: { jobNumbers?: Record<string, number> }) {
  const { entries, state, online, retry, discard, flush } = useSync();
  const [open, setOpen] = useState(false);
  const waiting = entries.filter((e) => e.state === "pending").length;
  const stuck = entries.filter((e) => e.state !== "pending");

  if (online && !waiting && !stuck.length) return null;

  const label = stuck.length
    ? `${stuck.length} need${stuck.length === 1 ? "s" : ""} attention`
    : !online
      ? `Offline${waiting ? ` · ${waiting} waiting` : ""}`
      : state === "syncing"
        ? `Syncing ${waiting}…`
        : `${waiting} waiting to sync`;
  const Icon = stuck.length ? AlertTriangle : !online ? CloudOff : state === "syncing" ? Loader2 : RefreshCw;

  return (
    <>
      <button
        type="button"
        onClick={() => (stuck.length ? setOpen(true) : void flush())}
        className={cn(
          "motion-press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-transform active:scale-[0.97]",
          stuck.length
            ? "bg-destructive/15 text-destructive"
            : !online
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary",
        )}
        aria-live="polite"
      >
        <Icon
          className={cn("size-3.5", state === "syncing" && !stuck.length && "animate-spin")}
          aria-hidden
        />
        {label}
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Changes that need attention"
        description="These couldn't be applied. Retry, or discard them."
      >
        <ul className="space-y-3">
          {stuck.map((e) => (
            <li key={e.id} className="rounded-xl border p-3">
              <p className="text-sm font-medium">
                {DESCRIBE[e.kind]}
                {jobNumbers?.[e.jobId] ? ` · ${formatJobNumber(jobNumbers[e.jobId]!)}` : ""}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{e.error}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void retry(e.id)}>
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => void discard(e.id)}
                >
                  Discard
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
