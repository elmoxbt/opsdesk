"use client";

import type { AuditLogDto, JobStatus } from "@opsdesk/shared";
import { Avatar } from "@opsdesk/ui/avatar";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { useAuditLogs } from "@/lib/api/hooks";
import { formatDateTime, relativeTime } from "@/lib/format";

const FIELD_LABELS: Record<string, string> = {
  technicianId: "technician",
  scheduledStart: "start time",
  scheduledEnd: "end time",
  serviceTypeId: "service",
  priceMinor: "price",
  notes: "notes",
  checklist: "checklist",
};

const STATUS_WORDS: Record<JobStatus, string> = {
  REQUESTED: "moved the job back to requested",
  SCHEDULED: "scheduled the job",
  EN_ROUTE: "marked the job en route",
  IN_PROGRESS: "started the job",
  COMPLETED: "completed the job",
  INVOICED: "invoiced the job",
  PAID: "recorded payment",
  CANCELLED: "cancelled the job",
};

export function describe(entry: AuditLogDto): string {
  const after = (entry.after ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case "job.created":
      return "created the job";
    case "job.status_changed": {
      const words = STATUS_WORDS[after.status as JobStatus] ?? "changed the status";
      return after.reason ? `${words}: “${String(after.reason)}”` : words;
    }
    case "job.updated": {
      const fields = Object.keys(after).map((k) => FIELD_LABELS[k] ?? k);
      return `updated the ${fields.join(", ")}`;
    }
    default:
      return entry.action.replace(/[._]/g, " ");
  }
}

export function ActivityTimeline({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { organization } = useSession();
  const logs = useAuditLogs({ entityType, entityId, pageSize: 50 });

  if (logs.isPending) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (logs.isError) return <p className="text-sm text-muted-foreground">Activity couldn&apos;t be loaded.</p>;

  if (logs.data.items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No activity recorded yet. Changes made from now on will appear here.
      </p>
    );
  }

  return (
    <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-3.5 before:w-px before:bg-border">
      {logs.data.items.map((e) => (
        <li key={e.id} className="relative flex gap-3">
          <Avatar
            name={e.actor?.name ?? actorLabel(e)}
            src={e.actor?.avatarUrl}
            size="sm"
            className="ring-4 ring-card"
          />
          <div className="min-w-0 pt-0.5 text-sm">
            <p>
              <span className="font-medium">{e.actor?.name ?? actorLabel(e)}</span>{" "}
              <span className="text-muted-foreground">{describe(e)}</span>
            </p>
            <time
              dateTime={e.createdAt}
              title={formatDateTime(e.createdAt, organization.timezone)}
              className="text-xs text-muted-foreground"
            >
              {relativeTime(e.createdAt)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Who did it when no staff member did: the customer (booking page), an integration, or the system. */
function actorLabel(e: AuditLogDto): string {
  return e.actorType === "PUBLIC" ? "Online booking" : e.actorType === "API_KEY" ? "API" : "System";
}
