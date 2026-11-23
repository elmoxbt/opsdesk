"use client";

import { formatJobNumber, JOB_STATUSES, type JobDto, type JobStatus } from "@opsdesk/shared";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JobsIllustration, SearchIllustration } from "@opsdesk/ui/illustrations";
import { JOB_FORM_ID, JobForm } from "@/components/jobs/job-form";
import { StatusFilter } from "@/components/jobs/status-filter";
import { Avatar } from "@opsdesk/ui/avatar";
import { Button } from "@opsdesk/ui/button";
import { Card } from "@opsdesk/ui/card";
import { Sheet } from "@opsdesk/ui/dialog";
import { Input, NativeSelect } from "@opsdesk/ui/input";
import { Pagination } from "@opsdesk/ui/pagination";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { AnimatedItem, AnimatedRow, Table, TableSkeleton, Td, Th, useFirstLoad } from "@opsdesk/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { canManage, useSession } from "@/hooks/use-session";
import { useUrlState } from "@/hooks/use-url-state";
import { errorMessage } from "@/lib/api/client";
import { useJobs, useTechnicians } from "@/lib/api/hooks";
import { formatTimeRange, money } from "@/lib/format";

const KEYS = ["q", "status", "technicianId", "sort", "page"] as const;

export function JobsView() {
  const user = useSession();
  const router = useRouter();
  const manager = canManage(user);
  const [url, setUrl] = useUrlState(KEYS);
  const [search, setSearch] = useState(url.q ?? "");
  const debounced = useDebouncedValue(search);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const technicians = useTechnicians(manager);

  useEffect(() => {
    if ((url.q ?? "") !== debounced) setUrl({ q: debounced || undefined });
  }, [debounced, url.q, setUrl]);

  const status = (url.status
    ?.split(",")
    .filter((s): s is JobStatus => (JOB_STATUSES as readonly string[]).includes(s)) ?? []) as JobStatus[];
  const page = Number(url.page ?? 1);
  const query = {
    q: url.q,
    status,
    technicianId: url.technicianId,
    sort: url.sort ?? "-createdAt",
    page,
    pageSize: 20,
  };
  const jobs = useJobs(query);
  const animate = useFirstLoad(jobs.isSuccess);
  const filtered = Boolean(url.q || status.length || url.technicianId);
  const tz = user.organization.timezone;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description={manager ? "Every job across your team." : "Jobs assigned to you."}
        actions={
          manager && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New job
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                aria-label="Search jobs"
                placeholder="Search customer, notes or JOB-0042"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {manager && (
              <NativeSelect
                aria-label="Technician"
                className="sm:w-48"
                value={url.technicianId ?? ""}
                onChange={(e) => setUrl({ technicianId: e.target.value || undefined })}
              >
                <option value="">All technicians</option>
                <option value="unassigned">Unassigned</option>
                {technicians.data?.items.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            <NativeSelect
              aria-label="Sort"
              className="sm:w-44"
              value={url.sort ?? "-createdAt"}
              onChange={(e) => setUrl({ sort: e.target.value })}
            >
              <option value="-createdAt">Newest first</option>
              <option value="scheduledStart">Soonest scheduled</option>
              <option value="-scheduledStart">Latest scheduled</option>
            </NativeSelect>
          </div>
          <StatusFilter value={status} onChange={(v) => setUrl({ status: v.join(",") || undefined })} />
        </div>

        {jobs.isPending ? (
          <TableSkeleton cols={6} />
        ) : jobs.isError ? (
          <ErrorState message={errorMessage(jobs.error)} onRetry={() => void jobs.refetch()} />
        ) : jobs.data.items.length === 0 ? (
          filtered ? (
            <EmptyState
              illustration={SearchIllustration}
              title="No jobs match these filters"
              description="Try a different search or clear the filters."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setUrl({ q: undefined, status: undefined, technicianId: undefined });
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              illustration={JobsIllustration}
              title={manager ? "No jobs yet" : "Nothing assigned to you yet"}
              description={
                manager
                  ? "Create your first job to start scheduling your team."
                  : "When a dispatcher assigns you a job, it shows up here."
              }
              action={
                manager && (
                  <Button onClick={() => setCreating(true)}>
                    <Plus aria-hidden /> New job
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Job</Th>
                  <Th>Customer</Th>
                  <Th>Service</Th>
                  <Th>Technician</Th>
                  <Th>Scheduled</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Price</Th>
                </tr>
              </thead>
              <tbody className={jobs.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                {jobs.data.items.map((j, i) => (
                  <AnimatedRow
                    key={j.id}
                    index={i}
                    animate={animate}
                    className="cursor-pointer"
                    onClick={() => router.push(`/jobs/${j.id}`)}
                  >
                    <Td>
                      <Link
                        href={`/jobs/${j.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {formatJobNumber(j.number)}
                      </Link>
                    </Td>
                    <Td className="font-medium">{j.customer.name}</Td>
                    <Td className="text-muted-foreground">{j.serviceType.name}</Td>
                    <Td>
                      <TechnicianCell job={j} />
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">
                      {formatTimeRange(j.scheduledStart, j.scheduledEnd, tz)}
                    </Td>
                    <Td>
                      <StatusBadge status={j.status} />
                    </Td>
                    <Td className="text-right font-mono tabular-nums">
                      {money(j.priceMinor, user.organization.currency)}
                    </Td>
                  </AnimatedRow>
                ))}
              </tbody>
            </Table>
            <ul className="divide-y md:hidden">
              {jobs.data.items.map((j, i) => (
                <AnimatedItem key={j.id} index={i} animate={animate}>
                  <Link
                    href={`/jobs/${j.id}`}
                    className="block space-y-2 px-4 py-4 transition-colors active:bg-muted/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{j.customer.name}</p>
                        <p className="text-sm text-muted-foreground">{j.serviceType.name}</p>
                      </div>
                      <StatusBadge status={j.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatTimeRange(j.scheduledStart, j.scheduledEnd, tz)}</span>
                      <span className="font-mono">{formatJobNumber(j.number)}</span>
                    </div>
                  </Link>
                </AnimatedItem>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={20}
              total={jobs.data.total}
              onPage={(p) => setUrl({ page: String(p) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      <Sheet
        open={creating}
        onOpenChange={setCreating}
        title="New job"
        description="Add a technician and time now, or schedule it later."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" form={JOB_FORM_ID} loading={saving}>
              Create job
            </Button>
          </>
        }
      >
        <JobForm
          onPendingChange={setSaving}
          onDone={(job) => {
            setCreating(false);
            router.push(`/jobs/${job.id}`);
          }}
        />
      </Sheet>
    </div>
  );
}

function TechnicianCell({ job }: { job: JobDto }) {
  if (!job.technician) return <span className="text-sm text-muted-foreground">Unassigned</span>;
  return (
    <span className="flex items-center gap-2">
      <Avatar name={job.technician.name} src={job.technician.avatarUrl} size="sm" />
      <span className="truncate">{job.technician.name}</span>
    </span>
  );
}
