"use client";

import {
  API_SCOPE_LABELS,
  API_SCOPES,
  type ApiKeyDto,
  type ApiScope,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENTS,
  type WebhookEndpointDto,
  type WebhookEventType,
} from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { ConfirmDialog } from "@opsdesk/ui/confirm-dialog";
import { Dialog } from "@opsdesk/ui/dialog";
import { Field } from "@opsdesk/ui/field";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Input, NativeSelect } from "@opsdesk/ui/input";
import { PageTitle } from "@opsdesk/ui/page-title";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { cn } from "@opsdesk/ui/utils";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { ApiError, errorMessage } from "@/lib/api/client";
import {
  useApiKeys,
  useCreateApiKey,
  useDeleteWebhook,
  useDeliveries,
  useRedeliver,
  useRevokeApiKey,
  useRotateWebhookSecret,
  useSaveWebhook,
  useTestWebhook,
  useWebhooks,
} from "@/lib/api/hooks";
import { formatDateTime, relativeTime } from "@/lib/format";

export function DevelopersView() {
  const user = useSession();
  if (user.role !== "OWNER")
    return (
      <EmptyState
        illustration={NotFoundIllustration}
        title="Owners only"
        description="API keys and webhooks are managed by the business owner."
      />
    );
  return (
    <div className="space-y-6">
      <PageTitle>Developers</PageTitle>
      <PageHeader
        title="Developers"
        description="Connect other tools: API keys for scripts and integrations, webhooks to push changes out."
        actions={
          <Button asChild variant="outline">
            <a href="/api/docs" target="_blank" rel="noreferrer">
              API reference <ExternalLink aria-hidden />
            </a>
          </Button>
        }
      />
      <ApiKeys />
      <Webhooks />
    </div>
  );
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

function ApiKeys() {
  const user = useSession();
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["jobs:read"]);
  const [expiry, setExpiry] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const tz = user.organization.timezone;

  const submit = () =>
    create.mutate(
      { name, scopes, expiresInDays: expiry ? Number(expiry) : null },
      {
        onSuccess: (k) => {
          setCreating(false);
          setRevealed(k.key);
          setName("");
          setScopes(["jobs:read"]);
          setExpiry("");
        },
        onError: (e) =>
          e instanceof ApiError && e.details
            ? setErrors(Object.fromEntries(Object.entries(e.details).map(([k, v]) => [k, v[0]!])))
            : toast.error(errorMessage(e)),
      },
    );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" aria-hidden /> API keys
        </CardTitle>
        <Button size="sm" onClick={() => (setErrors({}), setCreating(true))}>
          <Plus aria-hidden /> New key
        </Button>
      </CardHeader>
      <CardContent>
        {keys.isPending ? (
          <Skeleton className="h-16" />
        ) : keys.isError ? (
          <ErrorState message={errorMessage(keys.error)} onRetry={() => void keys.refetch()} />
        ) : keys.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No keys yet. Create one per integration, with only the permissions it needs.
          </p>
        ) : (
          <ul className="divide-y">
            {keys.data.map((k) => {
              const expired = k.expiresAt && new Date(k.expiresAt) < new Date();
              return (
                <li key={k.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {k.name}{" "}
                      {(k.revokedAt || expired) && (
                        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {k.revokedAt ? "Revoked" : "Expired"}
                        </span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">opsk_{k.prefix}_••••</p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          {s}
                        </span>
                      ))}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <p>{k.lastUsedAt ? `Used ${relativeTime(k.lastUsedAt)}` : "Never used"}</p>
                    <p>
                      Created {formatDateTime(k.createdAt, tz, { timeStyle: undefined })}
                      {k.createdBy ? ` by ${k.createdBy.name}` : ""}
                    </p>
                    {k.expiresAt && !k.revokedAt && (
                      <p>Expires {formatDateTime(k.expiresAt, tz, { timeStyle: undefined })}</p>
                    )}
                  </div>
                  {!k.revokedAt && (
                    <Button variant="ghost" size="sm" onClick={() => setRevoking(k)}>
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New API key"
        description="Give it only the permissions the integration needs."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button loading={create.isPending} onClick={submit}>
              Create key
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Field label="Name" required error={errors.name} hint="e.g. Zapier, Accounting sync">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Permissions</legend>
            <div className="space-y-2">
              {API_SCOPES.map((s) => (
                <label key={s} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                    checked={scopes.includes(s)}
                    onChange={(e) =>
                      setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))
                    }
                  />
                  <span>
                    <span className="font-mono text-xs">{s}</span>
                    <span className="block text-muted-foreground">{API_SCOPE_LABELS[s]}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.scopes && <p className="mt-1 text-xs text-destructive">{errors.scopes}</p>}
          </fieldset>
          <Field label="Expires">
            <NativeSelect value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="">Never</option>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In a year</option>
            </NativeSelect>
          </Field>
        </div>
      </Dialog>

      <SecretReveal
        open={revealed !== null}
        onClose={() => setRevealed(null)}
        title="Copy your API key now"
        value={revealed ?? ""}
        note="This is the only time it's shown. We store only a hash of it, so it can't be recovered: if it's lost, revoke it and create another."
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke "${revoking?.name ?? ""}"?`}
        description="Requests using this key will fail immediately. This can't be undone."
        confirmLabel="Revoke key"
        destructive
        loading={revoke.isPending}
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSuccess: () => {
              toast.success("Key revoked");
              setRevoking(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function Webhooks() {
  const hooks = useWebhooks();
  const save = useSaveWebhook();
  const [editing, setEditing] = useState<WebhookEndpointDto | "new" | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Webhook className="size-4" aria-hidden /> Webhooks
        </CardTitle>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden /> Add endpoint
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          We POST signed JSON to your URL when things happen. Verify the{" "}
          <code className="font-mono text-xs">OpsDesk-Signature</code> header and dedupe on the event id;
          failed deliveries are retried with backoff.
        </p>
        {hooks.isPending ? (
          <Skeleton className="h-16" />
        ) : hooks.isError ? (
          <ErrorState message={errorMessage(hooks.error)} onRetry={() => void hooks.refetch()} />
        ) : hooks.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No endpoints yet.</p>
        ) : (
          hooks.data.map((h) => (
            <EndpointRow key={h.id} endpoint={h} onEdit={() => setEditing(h)} onSecret={setRevealed} />
          ))
        )}
      </CardContent>

      {editing !== null && (
        <EndpointDialog
          endpoint={editing === "new" ? undefined : editing}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(data) =>
            save.mutate(
              { id: editing === "new" ? undefined : editing.id, data },
              {
                onSuccess: (r) => {
                  setEditing(null);
                  if ("secret" in r) setRevealed((r as { secret: string }).secret);
                  else toast.success("Endpoint saved");
                },
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        />
      )}
      <SecretReveal
        open={revealed !== null}
        onClose={() => setRevealed(null)}
        title="Signing secret"
        value={revealed ?? ""}
        note="Shown once. Your receiver uses it to verify each request's signature. Rotate it here if it leaks."
      />
    </Card>
  );
}

function EndpointRow({
  endpoint: h,
  onEdit,
  onSecret,
}: {
  endpoint: WebhookEndpointDto;
  onEdit: () => void;
  onSecret: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const test = useTestWebhook();
  const rotate = useRotateWebhookSecret();
  const remove = useDeleteWebhook();
  const deliveries = useDeliveries(h.id, open);
  const redeliver = useRedeliver();

  return (
    <div className="rounded-xl border">
      <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              h.isActive ? "bg-status-completed" : "bg-status-overdue",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm">{h.url}</p>
            <p className="text-xs text-muted-foreground">
              {h.isActive ? "Active" : "Off"} · {h.events.join(", ")}
              {h.description ? ` · ${h.description}` : ""}
            </p>
            {h.disabledReason && (
              <p className="mt-1 flex items-center gap-1 text-xs text-status-overdue">
                <AlertTriangle className="size-3.5" aria-hidden /> {h.disabledReason}. Fix the receiver, then
                switch it back on.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            loading={test.isPending}
            onClick={() =>
              test.mutate(h.id, {
                onSuccess: (d) =>
                  d.status === "SUCCEEDED"
                    ? toast.success(`Test delivered (${d.responseStatus}, ${d.durationMs} ms)`)
                    : toast.error(`Test failed: ${d.error ?? d.responseStatus}`),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            <Send aria-hidden /> Test
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={rotate.isPending}
            onClick={() =>
              rotate.mutate(h.id, {
                onSuccess: (r) => onSecret(r.secret),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            <RefreshCw aria-hidden /> Rotate secret
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${h.url}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Deliveries{" "}
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t p-3">
          {deliveries.isPending ? (
            <Skeleton className="h-10" />
          ) : !deliveries.data?.length ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {deliveries.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3">
                  <span
                    className={cn(
                      "inline-flex w-24 items-center gap-1 text-xs",
                      d.status === "SUCCEEDED"
                        ? "text-status-completed"
                        : d.status === "FAILED"
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                  >
                    {d.status === "SUCCEEDED" ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : (
                      <AlertTriangle className="size-3.5" aria-hidden />
                    )}
                    {d.status === "SUCCEEDED" ? "Delivered" : d.status === "FAILED" ? "Failed" : "Retrying"}
                  </span>
                  <span className="font-mono text-xs">{d.eventType}</span>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(d.createdAt)} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                    {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}
                    {d.error && d.status !== "SUCCEEDED" ? ` · ${d.error}` : ""}
                  </span>
                  {d.status === "FAILED" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() =>
                        redeliver.mutate(
                          { id: h.id, deliveryId: d.id },
                          {
                            onSuccess: () => toast.success("Queued for redelivery"),
                            onError: (e) => toast.error(errorMessage(e)),
                          },
                        )
                      }
                    >
                      Redeliver
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this endpoint?"
        description="Nothing more will be sent to it, and its delivery history is removed."
        confirmLabel="Delete endpoint"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(h.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.success("Endpoint deleted");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function EndpointDialog({
  endpoint,
  saving,
  onClose,
  onSave,
}: {
  endpoint?: WebhookEndpointDto;
  saving: boolean;
  onClose: () => void;
  onSave: (data: {
    url: string;
    events: WebhookEventType[];
    description: string | null;
    isActive: boolean;
  }) => void;
}) {
  const [url, setUrl] = useState(endpoint?.url ?? "https://");
  const [events, setEvents] = useState<WebhookEventType[]>(
    (endpoint?.events as WebhookEventType[]) ?? ["job.created", "job.status_changed"],
  );
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [isActive, setIsActive] = useState(endpoint?.isActive ?? true);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={endpoint ? "Edit endpoint" : "Add endpoint"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={events.length === 0}
            onClick={() => onSave({ url, events, description: description || null, isActive })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="URL" required hint="Must be https in production">
          <Input type="url" className="font-mono" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Description">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. CRM sync"
          />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Events</legend>
          <div className="space-y-2">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents((cur) => (e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev)))
                  }
                />
                <span>
                  <span className="font-mono text-xs">{ev}</span>
                  <span className="block text-muted-foreground">{WEBHOOK_EVENT_LABELS[ev]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active
        </label>
      </div>
    </Dialog>
  );
}

function SecretReveal({
  open,
  onClose,
  title,
  value,
  note,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string;
  note: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setCopied(false);
          onClose();
        }
      }}
      title={title}
      description={note}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-muted p-3 font-mono text-xs">{value}</code>
        <Button
          variant="outline"
          size="icon"
          aria-label="Copy"
          onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </div>
    </Dialog>
  );
}
