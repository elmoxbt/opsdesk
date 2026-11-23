"use client";

import { formatJobNumber } from "@opsdesk/shared";
import { ArrowLeft, Mail, MapPin, Pencil, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { CUSTOMER_FORM_ID, CustomerForm } from "@/components/customers/customer-form";
import { JobsIllustration, NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { JOB_FORM_ID, JobForm } from "@/components/jobs/job-form";
import { Avatar } from "@opsdesk/ui/avatar";
import { Button } from "@opsdesk/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { Sheet } from "@opsdesk/ui/dialog";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { useSession } from "@/hooks/use-session";
import { ApiError, errorMessage } from "@/lib/api/client";
import { useCustomer, useJobs } from "@/lib/api/hooks";
import { formatTimeRange, money } from "@/lib/format";
import { PageTitle } from "@opsdesk/ui/page-title";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { organization } = useSession();
  const customer = useCustomer(id);
  const jobs = useJobs({ customerId: id, pageSize: 50, sort: "-createdAt" });
  const [editing, setEditing] = useState(false);
  const [booking, setBooking] = useState(false);
  const [saving, setSaving] = useState(false);

  if (customer.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (customer.isError) {
    return customer.error instanceof ApiError && customer.error.status === 404 ? (
      <EmptyState
        illustration={NotFoundIllustration}
        title="Customer not found"
        description="They may have been deleted."
        action={
          <Button asChild variant="outline">
            <Link href="/customers">Back to customers</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState message={errorMessage(customer.error)} onRetry={() => void customer.refetch()} />
    );
  }
  const c = customer.data;

  return (
    <div className="space-y-6">
      <PageTitle>{c.name}</PageTitle>
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Customers
      </Link>
      <Card>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Avatar name={c.name} size="lg" />
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <a
                  href={`tel:${c.phone.replace(/\s/g, "")}`}
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <Phone className="size-4" aria-hidden />
                  {c.phone}
                </a>
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    className="inline-flex items-center gap-1.5 hover:text-foreground"
                  >
                    <Mail className="size-4" aria-hidden />
                    {c.email}
                  </a>
                )}
                {c.address && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4" aria-hidden />
                    {c.address}
                  </span>
                )}
              </div>
              {c.notes && <p className="max-w-prose text-sm whitespace-pre-line">{c.notes}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit
            </Button>
            <Button onClick={() => setBooking(true)}>
              <Plus aria-hidden /> New job
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job history</CardTitle>
          {jobs.data && <span className="font-mono text-xs text-muted-foreground">{jobs.data.total}</span>}
        </CardHeader>
        {jobs.isPending ? (
          <CardContent className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </CardContent>
        ) : jobs.isError ? (
          <ErrorState message={errorMessage(jobs.error)} onRetry={() => void jobs.refetch()} />
        ) : jobs.data.items.length === 0 ? (
          <EmptyState
            illustration={JobsIllustration}
            title="No jobs for this customer"
            description="Book their first job to get started."
            action={
              <Button onClick={() => setBooking(true)}>
                <Plus aria-hidden /> New job
              </Button>
            }
          />
        ) : (
          <ul className="divide-y">
            {jobs.data.items.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/jobs/${j.id}`}
                  className="flex flex-col gap-1 px-5 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="font-mono text-xs text-muted-foreground sm:w-20">
                    {formatJobNumber(j.number)}
                  </span>
                  <span className="flex-1 font-medium">{j.serviceType.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatTimeRange(j.scheduledStart, j.scheduledEnd, organization.timezone)}
                  </span>
                  <span className="font-mono text-sm tabular-nums sm:w-28 sm:text-right">
                    {money(j.priceMinor, organization.currency)}
                  </span>
                  <StatusBadge status={j.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Sheet
        open={editing}
        onOpenChange={setEditing}
        title="Edit customer"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" form={CUSTOMER_FORM_ID} loading={saving}>
              Save changes
            </Button>
          </>
        }
      >
        <CustomerForm customer={c} onPendingChange={setSaving} onDone={() => setEditing(false)} />
      </Sheet>
      <Sheet
        open={booking}
        onOpenChange={setBooking}
        title={`New job for ${c.name}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setBooking(false)}>
              Cancel
            </Button>
            <Button type="submit" form={JOB_FORM_ID} loading={saving}>
              Create job
            </Button>
          </>
        }
      >
        <JobForm
          defaultCustomer={{ id: c.id, name: c.name }}
          onPendingChange={setSaving}
          onDone={(job) => router.push(`/jobs/${job.id}`)}
        />
      </Sheet>
    </div>
  );
}
