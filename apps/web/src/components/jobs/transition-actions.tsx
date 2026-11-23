"use client";

import {
  availableTransitions,
  checkTransition,
  type JobDto,
  type JobStatus,
  TRANSITION_DONE,
  TRANSITION_LABELS,
} from "@opsdesk/shared";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@opsdesk/ui/button";
import { Dialog } from "@opsdesk/ui/dialog";
import { Field } from "@opsdesk/ui/field";
import { Textarea } from "@opsdesk/ui/input";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import { useTransitionJob } from "@/lib/api/hooks";

/**
 * Buttons come from the shared state machine, so the UI only offers moves the
 * API will accept. A move blocked by a precondition stays visible but disabled,
 * with the reason, so people learn what to do next instead of hunting.
 */
export function TransitionActions({ job, onEdit }: { job: JobDto; onEdit: () => void }) {
  const user = useSession();
  const transition = useTransitionJob(job.id);
  const [pendingTo, setPendingTo] = useState<JobStatus | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const jobState = {
    technicianId: job.technician?.id ?? null,
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd,
  };
  const options = availableTransitions(job.status, user, jobState);

  const run = async (to: JobStatus, extra: { reason?: string } = {}) => {
    setPendingTo(to);
    try {
      await transition.mutateAsync({ to, version: job.version, ...extra });
      toast.success(TRANSITION_DONE[to]);
      setCancelOpen(false);
      setReason("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPendingTo(null);
    }
  };

  if (!options.length) return null;
  const forward = options.filter((o) => o !== "CANCELLED" && o !== "REQUESTED");
  const blocked = forward
    .map((to) => ({ to, check: checkTransition({ from: job.status, to, actor: user, job: jobState }) }))
    .find((x) => !x.check.ok);

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {options.includes("CANCELLED") && (
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setCancelOpen(true)}
          >
            Cancel job
          </Button>
        )}
        {options.includes("REQUESTED") && (
          <Button variant="outline" loading={pendingTo === "REQUESTED"} onClick={() => run("REQUESTED")}>
            {TRANSITION_LABELS.REQUESTED}
          </Button>
        )}
        {forward.map((to) => {
          const ok = checkTransition({ from: job.status, to, actor: user, job: jobState }).ok;
          return (
            <Button
              key={to}
              loading={pendingTo === to}
              disabled={!ok || pendingTo !== null}
              onClick={() => run(to)}
            >
              {TRANSITION_LABELS[to]}
            </Button>
          );
        })}
      </div>
      {blocked && !blocked.check.ok && (
        <p className="text-xs text-muted-foreground">
          {blocked.check.message}.{" "}
          <button
            type="button"
            onClick={onEdit}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Edit job
          </button>
        </p>
      )}

      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this job?"
        description="The customer and technician history is kept. This can't be undone."
        className="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep job
            </Button>
            <Button
              variant="destructive"
              loading={pendingTo === "CANCELLED"}
              disabled={!reason.trim()}
              onClick={() => run("CANCELLED", { reason })}
            >
              Cancel job
            </Button>
          </>
        }
      >
        <Field label="Reason" required hint="Shown in the job's activity log.">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}
