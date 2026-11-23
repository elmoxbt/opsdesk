"use client";

import { formatJobNumber, type JobDto } from "@opsdesk/shared";
import { ArrowLeft, CalendarClock, MapPin, Pencil, Phone, Wrench } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { ActivityTimeline } from "@/components/jobs/activity-timeline";
import { OnlineBadge } from "@/components/dispatch/job-card";
import { FieldWork } from "@/components/jobs/field-work";
import { JobBilling } from "@/components/jobs/job-billing";
import { NotificationLog } from "@/components/notification-log";
import { JOB_FORM_ID, JobForm } from "@/components/jobs/job-form";
import { TransitionActions } from "@/components/jobs/transition-actions";
import { Avatar } from "@opsdesk/ui/avatar";
import { Button } from "@opsdesk/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { Sheet } from "@opsdesk/ui/dialog";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { canManage, useSession } from "@/hooks/use-session";
import { ApiError, errorMessage } from "@/lib/api/client";
import { useJob, useUpdateJob } from "@/lib/api/hooks";
import { formatDateTime, formatTimeRange, money } from "@/lib/format";
import { PageTitle } from "@opsdesk/ui/page-title";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const job = useJob(id);

  if (job.isPending) return <DetailSkeleton />;
  if (job.isError) {
    return job.error instanceof ApiError && job.error.status === 404 ? (
      <EmptyState
        illustration={NotFoundIllustration}
        title="Job not found"
        description="It may have been removed, or it isn't assigned to you."
        action={
          <Button asChild variant="outline">
            <Link href="/jobs">Back to jobs</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState message={errorMessage(job.error)} onRetry={() => void job.refetch()} />
    );
  }
  return <JobDetail job={job.data} />;
}

function JobDetail({ job }: { job: JobDto }) {
  const user = useSession();
  const manager = canManage(user);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const tz = user.organization.timezone;

  // Brief highlight when the status changes (opacity-only flash).
  const lastStatus = useRef(job.status);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (lastStatus.current !== job.status) {
      lastStatus.current = job.status;
      setFlash((n) => n + 1);
    }
  }, [job.status]);

  const mapsUrl = job.customer.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.customer.address)}`
    : null;

  return (
    <div className="space-y-6">
      <PageTitle>{`${formatJobNumber(job.number)} · ${job.customer.name}`}</PageTitle>
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Jobs
      </Link>

      <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
        {flash > 0 && (
          <motion.div
            key={flash}
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-primary/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.1, times: [0, 0.2, 1] }}
          />
        )}
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{job.customer.name}</h1>
              <StatusBadge status={job.status} />
              {job.source === "BOOKING" && <OnlineBadge />}
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{formatJobNumber(job.number)}</span> · {job.serviceType.name}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            {manager && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
            )}
            <TransitionActions job={job} onEdit={() => setEditing(true)} />
          </div>
        </div>
        {job.status === "CANCELLED" && job.cancellationReason && (
          <p className="relative mt-4 rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="font-medium">Cancelled:</span> {job.cancellationReason}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-5 sm:grid-cols-2">
                <Detail icon={CalendarClock} label="Scheduled">
                  {formatTimeRange(job.scheduledStart, job.scheduledEnd, tz)}
                </Detail>
                <Detail icon={Wrench} label="Technician">
                  {job.technician ? (
                    <span className="flex items-center gap-2">
                      <Avatar name={job.technician.name} src={job.technician.avatarUrl} size="sm" />
                      {job.technician.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </Detail>
                <Detail icon={Phone} label="Phone">
                  <a
                    href={`tel:${job.customer.phone.replace(/\s/g, "")}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {job.customer.phone}
                  </a>
                </Detail>
                <Detail icon={MapPin} label="Address">
                  {mapsUrl ? (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {job.customer.address}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">No address</span>
                  )}
                </Detail>
              </dl>
              <div className="mt-6 grid gap-4 border-t pt-5 text-sm sm:grid-cols-3">
                <Stat label="Price" value={money(job.priceMinor, user.organization.currency)} mono />
                <Stat label="Started" value={formatDateTime(job.startedAt, tz)} />
                <Stat label="Completed" value={formatDateTime(job.completedAt, tz)} />
              </div>
              {job.notes && (
                <div className="mt-6 border-t pt-5">
                  <h3 className="text-sm font-medium">Notes</h3>
                  <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{job.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Checklist job={job} editable={manager} />
          <JobBilling job={job} />
          <NotificationLog entityType="Job" entityId={job.id} />
          <FieldWork jobId={job.id} />
        </div>

        {manager && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline entityType="Job" entityId={job.id} />
            </CardContent>
          </Card>
        )}
      </div>

      <Sheet
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${formatJobNumber(job.number)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" form={JOB_FORM_ID} loading={saving}>
              Save changes
            </Button>
          </>
        }
      >
        <JobForm job={job} onPendingChange={setSaving} onDone={() => setEditing(false)} />
      </Sheet>
    </div>
  );
}

function Checklist({ job, editable }: { job: JobDto; editable: boolean }) {
  const update = useUpdateJob(job.id);
  const done = job.checklist.filter((i) => i.done).length;

  const toggle = (itemId: string) => {
    update.mutate(
      {
        serviceTypeId: job.serviceType.id,
        technicianId: job.technician?.id ?? null,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        priceMinor: job.priceMinor,
        notes: job.notes,
        checklist: job.checklist.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
        version: job.version,
      },
      { onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checklist</CardTitle>
        {job.checklist.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {done}/{job.checklist.length}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {job.checklist.length === 0 ? (
          <p className="text-sm text-muted-foreground">No checklist items. Add some when editing the job.</p>
        ) : (
          <ul className="space-y-1">
            {job.checklist.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 has-[:disabled]:cursor-default">
                  <input
                    type="checkbox"
                    className="size-4 rounded accent-[var(--brand)]"
                    checked={item.done}
                    disabled={!editable || update.isPending}
                    onChange={() => toggle(item.id)}
                  />
                  <span className={item.done ? "text-muted-foreground line-through" : undefined}>
                    {item.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 text-sm">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 font-medium break-words">{children}</dd>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className={mono ? "mt-0.5 font-mono font-medium tabular-nums" : "mt-0.5 font-medium"}>{value}</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading job">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
