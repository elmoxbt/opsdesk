"use client";

import {
  api,
  ApiError,
  formatJobNumber,
  type JobDto,
  type JobMediaDto,
  TRANSITION_DONE,
} from "@opsdesk/shared";
import { BottomSheet } from "@opsdesk/ui/bottom-sheet";
import { Button } from "@opsdesk/ui/button";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { SuccessCheck } from "@opsdesk/ui/success-check";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock, MapPin, MoreHorizontal, Navigation, Phone, StickyNote } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { ChecklistSection } from "@/components/job/checklist";
import { CompleteSheet } from "@/components/job/complete-sheet";
import { PartsSection } from "@/components/job/parts";
import { PhotosSection } from "@/components/job/photos";
import { SyncPill } from "@/components/sync-pill";
import { directionsUrl, nextAction, telUrl } from "@/lib/next-action";
import { useSession } from "@/lib/session";
import { applyPending } from "@/offline/overlay";
import { useSync } from "@/offline/sync-provider";

/**
 * /tech/job?id=… (a query param, not /jobs/[id]): one static route means the
 * service worker can serve this page offline for ANY job, then it reads the id
 * and renders from the persisted cache.
 */
export default function JobPage() {
  return (
    <AuthGate>
      <Suspense>
        <JobScreen />
      </Suspense>
    </AuthGate>
  );
}

function JobScreen() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const router = useRouter();
  const me = useSession();
  const { features } = useClientConfig();
  const { entries, enqueue } = useSync();
  const [actions, setActions] = useState(false);
  const [completing, setCompleting] = useState(params.get("complete") === "1");
  const [celebrate, setCelebrate] = useState(false);
  const tz = me.organization.timezone;

  const job = useQuery({ queryKey: ["job", id], queryFn: () => api<JobDto>(`/jobs/${id}`), enabled: !!id });
  const media = useQuery({
    queryKey: ["media", id],
    queryFn: () => api<JobMediaDto>(`/jobs/${id}/media`),
    enabled: !!id,
  });

  if (!job.data) {
    if (job.isError && job.error instanceof ApiError && job.error.status === 404) {
      return (
        <EmptyState
          illustration={NotFoundIllustration}
          title="Job not found"
          description="It may have been reassigned to someone else."
          action={
            <Button asChild variant="outline">
              <Link href="/">Back to my jobs</Link>
            </Button>
          }
        />
      );
    }
    if (job.isError)
      return (
        <ErrorState
          message="Couldn't load this job, and it isn't saved on this device yet."
          onRetry={() => void job.refetch()}
        />
      );
    return (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading job">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  const server = job.data;
  const view = applyPending(server, entries);
  const action = nextAction(view.status);
  const working = view.status === "EN_ROUTE" || view.status === "IN_PROGRESS";
  const time = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(
          new Date(iso),
        )
      : "--:--";

  const primary = async () => {
    if (!action) return;
    if (action.type === "complete") return setCompleting(true);
    await enqueue({ kind: "transition", jobId: server.id, to: action.to, version: server.version });
    toast.success(TRANSITION_DONE[action.to]);
  };

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-[calc(env(safe-area-inset-bottom)+6rem)]">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/85 px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to my jobs"
          onClick={() => (history.length > 1 ? router.back() : router.push("/"))}
        >
          <ArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-muted-foreground">{formatJobNumber(server.number)}</p>
          <h1 className="truncate leading-tight font-semibold">{server.customer.name}</h1>
        </div>
        <SyncPill jobNumbers={{ [server.id]: server.number }} />
      </header>

      <main className="space-y-4 px-4 pt-4">
        <section className="rounded-2xl border bg-card p-4" aria-label="Job details">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{server.serviceType.name}</p>
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="size-4" aria-hidden />
                <span className="font-mono tabular-nums">
                  {time(view.scheduledStart)}–{time(view.scheduledEnd)}
                </span>
              </p>
            </div>
            <StatusBadge status={view.status} />
          </div>
          {server.customer.address && (
            <p className="mt-3 flex gap-1.5 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              {server.customer.address}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button asChild variant="outline" className="h-11" disabled={!server.customer.address}>
              <a
                href={server.customer.address ? directionsUrl(server.customer.address) : undefined}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation aria-hidden /> Directions
              </a>
            </Button>
            <Button asChild variant="outline" className="h-11">
              <a href={telUrl(server.customer.phone)}>
                <Phone aria-hidden /> Call
              </a>
            </Button>
          </div>
          {server.notes && (
            <p className="mt-4 flex gap-1.5 rounded-xl bg-muted p-3 text-sm whitespace-pre-line">
              <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              {server.notes}
            </p>
          )}
        </section>

        <ChecklistSection job={view} editable={working} />
        <PhotosSection
          jobId={server.id}
          media={media.data}
          canAdd={{ BEFORE: working, AFTER: view.status === "IN_PROGRESS" || view.status === "COMPLETED" }}
        />
        {features.inventory && <PartsSection jobId={server.id} editable={view.status === "IN_PROGRESS"} />}
        {media.data?.signature && (
          <section className="rounded-2xl border bg-card p-4" aria-labelledby="signed">
            <h2 id="signed" className="font-semibold">
              Signed off by {media.data.signature.signedByName}
            </h2>
            <img
              src={media.data.signature.url}
              alt={`Signature of ${media.data.signature.signedByName}`}
              className="mt-2 h-24 rounded-lg bg-white object-contain"
            />
          </section>
        )}
      </main>

      {/* Sticky action bar: the next step, big and thumb-reachable. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/90 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-12 shrink-0"
            aria-label="More actions"
            onClick={() => setActions(true)}
          >
            <MoreHorizontal aria-hidden />
          </Button>
          {action ? (
            <Button size="lg" className="h-12 flex-1 text-base" onClick={() => void primary()}>
              {action.label}
            </Button>
          ) : (
            <p className="flex h-12 flex-1 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
              {view.status === "COMPLETED"
                ? "Completed"
                : view.status === "CANCELLED"
                  ? "Cancelled"
                  : "Nothing to do yet"}
            </p>
          )}
        </div>
      </div>

      <BottomSheet
        open={actions}
        onOpenChange={setActions}
        title="Job actions"
        description={`${formatJobNumber(server.number)} · ${server.customer.name}`}
      >
        <div className="grid gap-2 pb-2">
          {action && (
            <Button
              size="lg"
              className="h-12 justify-start"
              onClick={() => {
                setActions(false);
                void primary();
              }}
            >
              {action.label}
            </Button>
          )}
          {server.customer.address && (
            <Button asChild size="lg" variant="outline" className="h-12 justify-start">
              <a href={directionsUrl(server.customer.address)} target="_blank" rel="noreferrer">
                <Navigation aria-hidden /> Directions
              </a>
            </Button>
          )}
          <Button asChild size="lg" variant="outline" className="h-12 justify-start">
            <a href={telUrl(server.customer.phone)}>
              <Phone aria-hidden /> Call {server.customer.name}
            </a>
          </Button>
        </div>
      </BottomSheet>

      <CompleteSheet
        open={completing}
        onOpenChange={setCompleting}
        server={server}
        view={view}
        media={media.data}
        onCompleted={() => setCelebrate(true)}
      />

      <AnimatePresence>
        {celebrate && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-background/95 p-6 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
          >
            <div className="flex flex-col items-center gap-4">
              <SuccessCheck className="size-24" />
              <div>
                <p className="text-xl font-semibold">Job completed</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {entries.some((e) => e.jobId === server.id)
                    ? "It'll sync as soon as you have signal."
                    : "The office can see it now."}
                </p>
              </div>
              <Button size="lg" className="h-12 px-8" onClick={() => router.push("/")}>
                Back to my jobs
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
