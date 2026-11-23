"use client";

import type { NotificationDto } from "@opsdesk/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { cn } from "@opsdesk/ui/utils";
import { AlertTriangle, Check, Clock, Mail, MessageCircle, Smartphone } from "lucide-react";
import { useState } from "react";
import { canManage, useSession } from "@/hooks/use-session";
import { useNotifications } from "@/lib/api/hooks";
import { formatDateTime } from "@/lib/format";

const CHANNEL = {
  EMAIL: { icon: Mail, label: "Email" },
  SMS: { icon: Smartphone, label: "SMS" },
  WHATSAPP: { icon: MessageCircle, label: "WhatsApp" },
} as const;

/** "What did we tell the customer, and did it arrive?" Office-only. */
export function NotificationLog({
  entityType,
  entityId,
}: {
  entityType: "Job" | "Invoice";
  entityId: string;
}) {
  const user = useSession();
  const manager = canManage(user);
  const log = useNotifications(entityType, entityId, manager);
  if (!manager) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Messages</CardTitle>
        {log.data && (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{log.data.length}</span>
        )}
      </CardHeader>
      <CardContent>
        {log.isPending ? (
          <Skeleton className="h-12" />
        ) : !log.data || log.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <ul className="space-y-3">
            {log.data.map((n) => (
              <Row key={n.id} n={n} tz={user.organization.timezone} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ n, tz }: { n: NotificationDto; tz: string }) {
  const [open, setOpen] = useState(false);
  const Icon = CHANNEL[n.channel].icon;
  return (
    <li className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 rounded-lg text-left"
      >
        <Icon
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-label={CHANNEL[n.channel].label}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{n.subject ?? n.body}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {n.recipient} · {formatDateTime(n.sentAt ?? n.createdAt, tz)}
          </span>
        </span>
        <Status n={n} />
      </button>
      {open && (
        <div className="mt-2 ml-7 space-y-1 rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
          {n.body}
          {n.error && (
            <p className="text-destructive">
              Last error (attempt {n.attempts}): {n.error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Status({ n }: { n: NotificationDto }) {
  const s =
    n.status === "SENT"
      ? { icon: Check, label: "Sent", cls: "text-status-completed" }
      : n.status === "FAILED"
        ? { icon: AlertTriangle, label: "Failed", cls: "text-destructive" }
        : {
            icon: Clock,
            label: n.attempts > 0 ? `Retrying (${n.attempts})` : "Queued",
            cls: "text-muted-foreground",
          };
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", s.cls)}>
      <s.icon className="size-3.5" aria-hidden />
      {s.label}
    </span>
  );
}
