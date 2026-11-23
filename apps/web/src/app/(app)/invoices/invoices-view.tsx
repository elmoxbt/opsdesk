"use client";

import { INVOICE_STATUSES, type InvoiceDto } from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Card } from "@opsdesk/ui/card";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { CountUp } from "@opsdesk/ui/count-up";
import { Dialog } from "@opsdesk/ui/dialog";
import { SearchIllustration, ServicesIllustration } from "@opsdesk/ui/illustrations";
import { Input } from "@opsdesk/ui/input";
import { PageTitle } from "@opsdesk/ui/page-title";
import { Pagination } from "@opsdesk/ui/pagination";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { AnimatedItem, AnimatedRow, Table, TableSkeleton, Td, Th, useFirstLoad } from "@opsdesk/ui/table";
import { cn } from "@opsdesk/ui/utils";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BILLING_FORM_ID, BillingForm } from "@/components/billing/billing-form";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSession } from "@/hooks/use-session";
import { useUrlState } from "@/hooks/use-url-state";
import { errorMessage } from "@/lib/api/client";
import { useInvoiceSummary, useInvoices } from "@/lib/api/hooks";
import { formatDateTime, money } from "@/lib/format";

const KEYS = ["q", "status", "page"] as const;
const FILTERS: Array<{ value: string | undefined; label: string }> = [
  { value: undefined, label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "SENT", label: "Sent" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PARTIALLY_PAID", label: "Part paid" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
];

export function InvoicesView() {
  const user = useSession();
  const config = useClientConfig();
  const router = useRouter();
  const [url, setUrl] = useUrlState(KEYS);
  const [search, setSearch] = useState(url.q ?? "");
  const debounced = useDebouncedValue(search);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const currency = user.organization.currency;

  useEffect(() => {
    if ((url.q ?? "") !== debounced) setUrl({ q: debounced || undefined });
  }, [debounced, url.q, setUrl]);

  const status = (INVOICE_STATUSES as readonly string[]).includes(url.status ?? "") ? url.status : undefined;
  const page = Number(url.page ?? 1);
  const invoices = useInvoices({ q: url.q, status, page, pageSize: 25 });
  const summary = useInvoiceSummary();
  const animate = useFirstLoad(invoices.isSuccess);
  const fmt = { style: "currency", currency, maximumFractionDigits: 0 } as const;

  const due = (i: InvoiceDto) => (
    <span className={cn(i.displayStatus === "OVERDUE" && "font-medium text-status-overdue")}>
      {formatDateTime(i.dueDate, user.organization.timezone, { timeStyle: undefined })}
    </span>
  );

  return (
    <div className="space-y-6">
      <PageTitle>Invoices</PageTitle>
      <PageHeader
        title="Invoices"
        description="Bill completed work, share a pay link, and see what's still owed."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New invoice
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Outstanding", value: summary.data?.outstandingMinor, filter: undefined },
          {
            label: `Overdue${summary.data ? ` (${summary.data.overdueCount})` : ""}`,
            value: summary.data?.overdueMinor,
            filter: "OVERDUE",
            warn: (summary.data?.overdueCount ?? 0) > 0,
          },
          { label: "Paid this month", value: summary.data?.paidThisMonthMinor, filter: "PAID" },
        ].map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => setUrl({ status: k.filter })}
            className="motion-press rounded-2xl border bg-card p-4 text-left transition-[transform,background-color] duration-150 hover:bg-accent/40 active:scale-[0.99]"
          >
            <p className="text-sm text-muted-foreground">{k.label}</p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-semibold tabular-nums",
                k.warn && "text-status-overdue",
              )}
            >
              {k.value === undefined ? (
                "—"
              ) : (
                <CountUp value={k.value / 100} format={fmt} locale={config.business.locale} />
              )}
            </p>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search invoices"
              placeholder="Search number or customer"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                aria-pressed={status === f.value}
                onClick={() => setUrl({ status: f.value })}
                className={cn(
                  "motion-press h-9 rounded-lg px-3 text-sm font-medium transition-[transform,background-color] duration-150 active:scale-[0.98]",
                  status === f.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {invoices.isPending ? (
          <TableSkeleton cols={6} />
        ) : invoices.isError ? (
          <ErrorState message={errorMessage(invoices.error)} onRetry={() => void invoices.refetch()} />
        ) : invoices.data.items.length === 0 ? (
          url.q || status ? (
            <EmptyState
              illustration={SearchIllustration}
              title="No invoices match"
              description="Try another search or filter."
            />
          ) : (
            <EmptyState
              illustration={ServicesIllustration}
              title="No invoices yet"
              description="Create one here, or open a completed job and press “Create invoice”."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> New invoice
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </thead>
              <tbody className={invoices.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                {invoices.data.items.map((i, idx) => (
                  <AnimatedRow
                    key={i.id}
                    index={idx}
                    animate={animate}
                    className="cursor-pointer"
                    onClick={() => router.push(`/invoices/${i.id}`)}
                  >
                    <Td className="font-mono text-sm font-medium">
                      <Link
                        href={`/invoices/${i.id}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {i.number}
                      </Link>
                    </Td>
                    <Td>{i.customer.name}</Td>
                    <Td>
                      <StatusBadge status={i.displayStatus} />
                    </Td>
                    <Td className="text-sm">{due(i)}</Td>
                    <Td className="text-right font-mono tabular-nums">{money(i.totalMinor, i.currency)}</Td>
                    <Td className="text-right font-mono tabular-nums">
                      {i.status === "VOID" ? "—" : money(i.balanceMinor, i.currency)}
                    </Td>
                  </AnimatedRow>
                ))}
              </tbody>
            </Table>
            <ul className="divide-y md:hidden">
              {invoices.data.items.map((i, idx) => (
                <AnimatedItem key={i.id} index={idx} animate={animate}>
                  <Link href={`/invoices/${i.id}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.customer.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {i.number} · due {due(i)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm tabular-nums">{money(i.totalMinor, i.currency)}</p>
                      <StatusBadge status={i.displayStatus} />
                    </div>
                  </Link>
                </AnimatedItem>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={25}
              total={invoices.data.total}
              onPage={(p) => setUrl({ page: String(p) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New invoice"
        description="Saved as a draft. Nothing is sent until you issue it."
        className="sm:max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" form={BILLING_FORM_ID} loading={saving}>
              Save draft
            </Button>
          </>
        }
      >
        {creating && (
          <BillingForm
            kind="invoice"
            defaultTaxBps={config.business.taxRateBps}
            onPendingChange={setSaving}
            onDone={(saved) => {
              setCreating(false);
              router.push(`/invoices/${saved.id}`);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
