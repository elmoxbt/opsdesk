"use client";

import {
  formatJobNumber,
  fromZonedInputValue,
  type JobDto,
  toZonedInputValue,
  type UserSummaryDto,
} from "@opsdesk/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@opsdesk/ui/button";
import { Dialog } from "@opsdesk/ui/dialog";
import { Field } from "@opsdesk/ui/field";
import { Input, NativeSelect } from "@opsdesk/ui/input";
import { isMovable } from "./job-card";

interface Props {
  job: JobDto | null;
  technicians: UserSummaryDto[];
  tz: string;
  pending: boolean;
  error: { message: string } | null;
  onClose: () => void;
  onSubmit: (technician: UserSummaryDto, startIso: string) => void;
}

/**
 * The non-drag way to do everything the board does (WCAG 2.5.7): pick a
 * technician and a start time. Opened by clicking or pressing Enter on a card.
 */
export function RescheduleDialog({ job, technicians, tz, pending, error, onClose, onSubmit }: Props) {
  const [techId, setTechId] = useState("");
  const [start, setStart] = useState("");

  useEffect(() => {
    if (!job) return;
    setTechId(job.technician?.id ?? technicians[0]?.id ?? "");
    setStart(toZonedInputValue(job.scheduledStart, tz));
  }, [job, technicians, tz]);

  if (!job) return <Dialog open={false} onOpenChange={onClose} title="" children={null} />;
  const movable = isMovable(job);
  const tech = technicians.find((t) => t.id === techId);
  const iso = fromZonedInputValue(start, tz);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${movable ? (job.scheduledStart ? "Reschedule" : "Schedule") : "View"} ${formatJobNumber(job.number)}`}
      description={`${job.customer.name} · ${job.serviceType.name}`}
      footer={
        <>
          <Button asChild variant="outline">
            <Link href={`/jobs/${job.id}`}>Open job</Link>
          </Button>
          {movable && (
            <Button
              loading={pending}
              disabled={!tech || !iso}
              onClick={() => tech && iso && onSubmit(tech, iso)}
            >
              {job.scheduledStart ? "Save" : "Schedule"}
            </Button>
          )}
        </>
      }
    >
      {movable ? (
        <div className="space-y-4">
          <Field label="Technician" required>
            <NativeSelect value={techId} onChange={(e) => setTechId(e.target.value)}>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Start" required hint={`Keeps the job's duration. Time zone: ${tz}`}>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error.message}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This job is already under way, so it can&apos;t be moved on the board.
        </p>
      )}
    </Dialog>
  );
}
