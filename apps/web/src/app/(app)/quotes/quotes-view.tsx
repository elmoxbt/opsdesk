"use client";

import { QUOTE_STATUSES, type QuoteDto } from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Card } from "@opsdesk/ui/card";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { Dialog } from "@opsdesk/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@opsdesk/ui/dropdown-menu";
import { SearchIllustration, ServicesIllustration } from "@opsdesk/ui/illustrations";
import { Input } from "@opsdesk/ui/input";
import { PageTitle } from "@opsdesk/ui/page-title";
import { Pagination } from "@opsdesk/ui/pagination";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { AnimatedItem, AnimatedRow, Table, TableSkeleton, Td, Th, useFirstLoad } from "@opsdesk/ui/table";
import { cn } from "@opsdesk/ui/utils";
import { Check, FileText, MoreHorizontal, Pencil, Plus, Search, Send, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BILLING_FORM_ID, BillingForm } from "@/components/billing/billing-form";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSession } from "@/hooks/use-session";
import { useUrlState } from "@/hooks/use-url-state";
import { errorMessage } from "@/lib/api/client";
import { useConvertQuote, useQuoteStatus, useQuotes } from "@/lib/api/hooks";
import { formatDateTime, money } from "@/lib/format";

const KEYS = ["q", "status", "page"] as const;
const FILTERS = [undefined, "DRAFT", "SENT", "ACCEPTED", "DECLINED", "CONVERTED"] as const;
const FILTER_LABEL: Record<string, string> = {
  all: "All",
  DRAFT: "Drafts",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CONVERTED: "Invoiced",
};

export function QuotesView() {
  const user = useSession();
  const config = useClientConfig();
  const router = useRouter();
  const [url, setUrl] = useUrlState(KEYS);
  const [search, setSearch] = useState(url.q ?? "");
  const debounced = useDebouncedValue(search);
  const [editing, setEditing] = useState<QuoteDto | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const setStatus = useQuoteStatus();
  const convert = useConvertQuote();

  useEffect(() => {
    if ((url.q ?? "") !== debounced) setUrl({ q: debounced || undefined });
  }, [debounced, url.q, setUrl]);

  const status = (QUOTE_STATUSES as readonly string[]).includes(url.status ?? "") ? url.status : undefined;
  const page = Number(url.page ?? 1);
  const quotes = useQuotes({ q: url.q, status, page, pageSize: 25 });
  const animate = useFirstLoad(quotes.isSuccess);

  const move = (q: QuoteDto, to: "SENT" | "ACCEPTED" | "DECLINED") =>
    setStatus.mutate(
      { id: q.id, status: to },
      {
        onSuccess: () => toast.success(`${q.number} marked ${to.toLowerCase()}`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  const menu = (q: QuoteDto) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${q.number}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {q.status === "DRAFT" && (
          <>
            <DropdownMenuItem onSelect={() => setEditing(q)}>
              <Pencil aria-hidden /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => move(q, "SENT")}>
              <Send aria-hidden /> Mark as sent
            </DropdownMenuItem>
          </>
        )}
        {q.status === "SENT" && (
          <>
            <DropdownMenuItem onSelect={() => move(q, "ACCEPTED")}>
              <Check aria-hidden /> Customer accepted
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => move(q, "DECLINED")}>
              <X aria-hidden /> Customer declined
            </DropdownMenuItem>
          </>
        )}
        {q.status === "ACCEPTED" && (
          <DropdownMenuItem
            onSelect={() =>
              convert.mutate(q.id, {
                onSuccess: (inv) => {
                  toast.success(`Draft ${inv.number} created from ${q.number}`);
                  router.push(`/invoices/${inv.id}`);
                },
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            <FileText aria-hidden /> Convert to invoice
          </DropdownMenuItem>
        )}
        {q.invoiceId && (
          <DropdownMenuItem onSelect={() => router.push(`/invoices/${q.invoiceId}`)}>
            <FileText aria-hidden /> Open invoice
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const valid = (q: QuoteDto) =>
    formatDateTime(q.validUntil, user.organization.timezone, { timeStyle: undefined });

  return (
    <div className="space-y-6">
      <PageTitle>Quotes</PageTitle>
      <PageHeader
        title="Quotes"
        description="Price the work up front. Accepted quotes become invoices in one click."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> New quote
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search quotes"
              placeholder="Search number or customer"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f ?? "all"}
                type="button"
                aria-pressed={status === f}
                onClick={() => setUrl({ status: f })}
                className={cn(
                  "motion-press h-9 rounded-lg px-3 text-sm font-medium transition-[transform,background-color] duration-150 active:scale-[0.98]",
                  status === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {FILTER_LABEL[f ?? "all"]}
              </button>
            ))}
          </div>
        </div>

        {quotes.isPending ? (
          <TableSkeleton cols={6} />
        ) : quotes.isError ? (
          <ErrorState message={errorMessage(quotes.error)} onRetry={() => void quotes.refetch()} />
        ) : quotes.data.items.length === 0 ? (
          url.q || status ? (
            <EmptyState
              illustration={SearchIllustration}
              title="No quotes match"
              description="Try another search or filter."
            />
          ) : (
            <EmptyState
              illustration={ServicesIllustration}
              title="No quotes yet"
              description="Send a price before the work starts; convert it when the customer says yes."
              action={
                <Button onClick={() => setEditing("new")}>
                  <Plus aria-hidden /> New quote
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Quote</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Valid until</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className={quotes.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                {quotes.data.items.map((q, idx) => (
                  <AnimatedRow key={q.id} index={idx} animate={animate}>
                    <Td className="font-mono text-sm font-medium">{q.number}</Td>
                    <Td>{q.customer.name}</Td>
                    <Td>
                      <StatusBadge status={q.status} />
                    </Td>
                    <Td className="text-sm">{valid(q)}</Td>
                    <Td className="text-right font-mono tabular-nums">{money(q.totalMinor, q.currency)}</Td>
                    <Td>{menu(q)}</Td>
                  </AnimatedRow>
                ))}
              </tbody>
            </Table>
            <ul className="divide-y md:hidden">
              {quotes.data.items.map((q, idx) => (
                <AnimatedItem
                  key={q.id}
                  index={idx}
                  animate={animate}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{q.customer.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {q.number} · {money(q.totalMinor, q.currency)}
                    </p>
                  </div>
                  <StatusBadge status={q.status} />
                  {menu(q)}
                </AnimatedItem>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={25}
              total={quotes.data.total}
              onPage={(p) => setUrl({ page: String(p) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "new" ? "New quote" : `Edit ${editing?.number ?? "quote"}`}
        className="sm:max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form={BILLING_FORM_ID} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {editing !== null && (
          <BillingForm
            kind="quote"
            existing={editing === "new" ? undefined : editing}
            defaultTaxBps={config.business.taxRateBps}
            onPendingChange={setSaving}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
      <p className="text-xs text-muted-foreground">
        Tip: invoices for finished jobs are quickest from the job page.{" "}
        <Link href="/jobs?status=COMPLETED" className="underline">
          Completed jobs
        </Link>
      </p>
    </div>
  );
}
