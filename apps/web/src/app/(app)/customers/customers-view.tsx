"use client";

import type { CustomerDto } from "@opsdesk/shared";
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CUSTOMER_FORM_ID, CustomerForm } from "@/components/customers/customer-form";
import { CustomersIllustration, SearchIllustration } from "@opsdesk/ui/illustrations";
import { Avatar } from "@opsdesk/ui/avatar";
import { Button } from "@opsdesk/ui/button";
import { Card } from "@opsdesk/ui/card";
import { ConfirmDialog } from "@opsdesk/ui/confirm-dialog";
import { Sheet } from "@opsdesk/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@opsdesk/ui/dropdown-menu";
import { Input, NativeSelect } from "@opsdesk/ui/input";
import { Pagination } from "@opsdesk/ui/pagination";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { AnimatedItem, AnimatedRow, Table, TableSkeleton, Td, Th, useFirstLoad } from "@opsdesk/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useUrlState } from "@/hooks/use-url-state";
import { errorMessage } from "@/lib/api/client";
import { useCustomers, useDeleteCustomer } from "@/lib/api/hooks";

const KEYS = ["q", "sort", "page"] as const;

export function CustomersView() {
  const [url, setUrl] = useUrlState(KEYS);
  const [search, setSearch] = useState(url.q ?? "");
  const debounced = useDebouncedValue(search);
  const [editing, setEditing] = useState<CustomerDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomerDto | null>(null);
  const [saving, setSaving] = useState(false);
  const remove = useDeleteCustomer();

  useEffect(() => {
    if ((url.q ?? "") !== debounced) setUrl({ q: debounced || undefined });
  }, [debounced, url.q, setUrl]);

  const page = Number(url.page ?? 1);
  const customers = useCustomers({ q: url.q, sort: url.sort ?? "name", page, pageSize: 20 });
  const animate = useFirstLoad(customers.isSuccess);

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(`${deleting.name} deleted`);
        setDeleting(null);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const rowMenu = (c: CustomerDto) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${c.name}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => setEditing(c)}>
          <Pencil aria-hidden /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={() => setDeleting(c)}>
          <Trash2 aria-hidden /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Everyone you've worked for, with their job history."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add customer
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search customers"
              placeholder="Search name, phone or email"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <NativeSelect
            aria-label="Sort"
            className="sm:w-44"
            value={url.sort ?? "name"}
            onChange={(e) => setUrl({ sort: e.target.value })}
          >
            <option value="name">Name A–Z</option>
            <option value="-createdAt">Newest first</option>
          </NativeSelect>
        </div>

        {customers.isPending ? (
          <TableSkeleton cols={5} />
        ) : customers.isError ? (
          <ErrorState message={errorMessage(customers.error)} onRetry={() => void customers.refetch()} />
        ) : customers.data.items.length === 0 ? (
          url.q ? (
            <EmptyState
              illustration={SearchIllustration}
              title={`No customers match “${url.q}”`}
              description="Check the spelling, or search by phone number."
            />
          ) : (
            <EmptyState
              illustration={CustomersIllustration}
              title="No customers yet"
              description="Add a customer to start booking jobs for them."
              action={
                <Button onClick={() => setEditing("new")}>
                  <Plus aria-hidden /> Add customer
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th>Email</Th>
                  <Th className="text-right">Jobs</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className={customers.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                {customers.data.items.map((c, i) => (
                  <AnimatedRow key={c.id} index={i} animate={animate}>
                    <Td>
                      <Link
                        href={`/customers/${c.id}`}
                        className="flex items-center gap-3 font-medium hover:underline"
                      >
                        <Avatar name={c.name} size="sm" />
                        {c.name}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{c.phone}</Td>
                    <Td className="text-muted-foreground">{c.email ?? "—"}</Td>
                    <Td className="text-right font-mono tabular-nums">{c.jobCount ?? 0}</Td>
                    <Td>{rowMenu(c)}</Td>
                  </AnimatedRow>
                ))}
              </tbody>
            </Table>
            <ul className="divide-y md:hidden">
              {customers.data.items.map((c, i) => (
                <AnimatedItem
                  key={c.id}
                  index={i}
                  animate={animate}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <Avatar name={c.name} />
                  <Link href={`/customers/${c.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{c.phone}</p>
                  </Link>
                  {rowMenu(c)}
                </AnimatedItem>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={20}
              total={customers.data.total}
              onPage={(p) => setUrl({ page: String(p) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "new" ? "Add customer" : "Edit customer"}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form={CUSTOMER_FORM_ID} loading={saving}>
              {editing === "new" ? "Add customer" : "Save changes"}
            </Button>
          </>
        }
      >
        {editing !== null && (
          <CustomerForm
            customer={editing === "new" ? undefined : editing}
            onPendingChange={setSaving}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "customer"}?`}
        description="This permanently removes the customer. Customers with jobs can't be deleted, so their history is kept."
        confirmLabel="Delete customer"
        destructive
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
