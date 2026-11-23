"use client";

import type { JobDto } from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { Receipt } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { canManage, useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import { useInvoiceFromJob, useInvoices } from "@/lib/api/hooks";
import { money } from "@/lib/format";

const BILLABLE: ReadonlyArray<JobDto["status"]> = ["COMPLETED", "INVOICED", "PAID"];

/** Office-only: the job's invoice, or one click to draft it from the service + parts used. */
export function JobBilling({ job }: { job: JobDto }) {
  const user = useSession();
  const router = useRouter();
  const visible = canManage(user) && BILLABLE.includes(job.status);
  const invoices = useInvoices({ jobId: job.id, pageSize: 1 }, visible);
  const create = useInvoiceFromJob();
  if (!visible) return null;
  const inv = invoices.data?.items[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
      </CardHeader>
      <CardContent>
        {invoices.isPending ? (
          <Skeleton className="h-10" />
        ) : inv ? (
          <Link
            href={`/invoices/${inv.id}`}
            className="flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:bg-accent/40"
          >
            <div>
              <p className="font-mono text-sm font-medium">{inv.number}</p>
              <p className="text-xs text-muted-foreground">
                {inv.balanceMinor > 0 && inv.status !== "DRAFT"
                  ? `${money(inv.balanceMinor, inv.currency)} outstanding`
                  : money(inv.totalMinor, inv.currency)}
              </p>
            </div>
            <StatusBadge status={inv.displayStatus} />
          </Link>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Not invoiced yet. The draft includes the service and every part used; you can review it before
              sending.
            </p>
            <Button
              loading={create.isPending}
              onClick={() =>
                create.mutate(job.id, {
                  onSuccess: (created) => {
                    toast.success(`Draft ${created.number} created`);
                    router.push(`/invoices/${created.id}`);
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              <Receipt aria-hidden /> Create invoice
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
