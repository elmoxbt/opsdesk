"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type InventoryItemData,
  type InventoryItemDto,
  type InventoryItemInput,
  inventoryItemInputSchema,
  toMinor,
} from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Card } from "@opsdesk/ui/card";
import { ConfirmDialog } from "@opsdesk/ui/confirm-dialog";
import { Dialog } from "@opsdesk/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@opsdesk/ui/dropdown-menu";
import { Field, FieldGroup } from "@opsdesk/ui/field";
import { SearchIllustration, ServicesIllustration } from "@opsdesk/ui/illustrations";
import { Input } from "@opsdesk/ui/input";
import { Pagination } from "@opsdesk/ui/pagination";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { AnimatedItem, AnimatedRow, Table, TableSkeleton, Td, Th, useFirstLoad } from "@opsdesk/ui/table";
import { cn } from "@opsdesk/ui/utils";
import { AlertTriangle, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { PageTitle } from "@opsdesk/ui/page-title";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { canManage, useSession } from "@/hooks/use-session";
import { useUrlState } from "@/hooks/use-url-state";
import { errorMessage } from "@/lib/api/client";
import { useDeleteInventoryItem, useInventory, useSaveInventoryItem } from "@/lib/api/hooks";
import { money } from "@/lib/format";
import { handleFormError } from "@/lib/forms";

const KEYS = ["q", "low", "page"] as const;
const FORM_ID = "inventory-form";

export function InventoryView() {
  const user = useSession();
  const manager = canManage(user);
  const [url, setUrl] = useUrlState(KEYS);
  const [search, setSearch] = useState(url.q ?? "");
  const debounced = useDebouncedValue(search);
  const [editing, setEditing] = useState<InventoryItemDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<InventoryItemDto | null>(null);
  const [saving, setSaving] = useState(false);
  const remove = useDeleteInventoryItem();

  useEffect(() => {
    if ((url.q ?? "") !== debounced) setUrl({ q: debounced || undefined });
  }, [debounced, url.q, setUrl]);

  const page = Number(url.page ?? 1);
  const items = useInventory({ q: url.q, lowStock: url.low === "1" ? true : undefined, page, pageSize: 25 });
  const lowCount = useInventory({ lowStock: true, pageSize: 1 }).data?.total ?? 0;
  const animate = useFirstLoad(items.isSuccess);
  const currency = user.organization.currency;

  const menu = (i: InventoryItemDto) =>
    manager && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${i.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(i)}>
            <Pencil aria-hidden /> Edit / stocktake
          </DropdownMenuItem>
          {user.role === "OWNER" && (
            <DropdownMenuItem destructive onSelect={() => setDeleting(i)}>
              <Trash2 aria-hidden /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <div className="space-y-6">
      <PageTitle>Inventory</PageTitle>
      <PageHeader
        title="Inventory"
        description="Stock levels. Parts technicians record on jobs are deducted automatically."
        actions={
          manager && (
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add item
            </Button>
          )
        }
      />

      {lowCount > 0 && url.low !== "1" && (
        <button
          type="button"
          onClick={() => setUrl({ low: "1" })}
          className="flex w-full items-center gap-3 rounded-xl border border-status-en-route/40 bg-status-en-route/10 px-4 py-3 text-left text-sm transition-colors hover:bg-status-en-route/15"
        >
          <AlertTriangle className="size-4 shrink-0 text-status-en-route" aria-hidden />
          <span>
            <span className="font-medium">
              {lowCount} item{lowCount === 1 ? " is" : "s are"} at or below the reorder level.
            </span>{" "}
            Show them
          </span>
        </button>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search inventory"
              placeholder="Search name or SKU"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            aria-pressed={url.low === "1"}
            onClick={() => setUrl({ low: url.low === "1" ? undefined : "1" })}
            className={cn(
              "motion-press inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-[transform,background-color] duration-150 active:scale-[0.98]",
              url.low === "1"
                ? "border-transparent bg-status-en-route/15 text-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <AlertTriangle className="size-4" aria-hidden /> Low stock only
          </button>
        </div>

        {items.isPending ? (
          <TableSkeleton cols={5} />
        ) : items.isError ? (
          <ErrorState message={errorMessage(items.error)} onRetry={() => void items.refetch()} />
        ) : items.data.items.length === 0 ? (
          url.q || url.low ? (
            <EmptyState
              illustration={SearchIllustration}
              title="No items match"
              description="Try another search, or clear the low-stock filter."
            />
          ) : (
            <EmptyState
              illustration={ServicesIllustration}
              title="No stock items yet"
              description="Add the parts your technicians use so they can record them on jobs."
              action={
                manager && (
                  <Button onClick={() => setEditing("new")}>
                    <Plus aria-hidden /> Add item
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
                  <Th>Item</Th>
                  <Th>SKU</Th>
                  <Th className="text-right">In stock</Th>
                  <Th className="text-right">Reorder at</Th>
                  <Th className="text-right">Unit cost</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className={items.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                {items.data.items.map((i, idx) => (
                  <AnimatedRow key={i.id} index={idx} animate={animate}>
                    <Td className="font-medium">{i.name}</Td>
                    <Td className="font-mono text-xs">{i.sku}</Td>
                    <Td className="text-right">
                      <StockLevel item={i} />
                    </Td>
                    <Td className="text-right font-mono tabular-nums text-muted-foreground">
                      {i.reorderThreshold}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">{money(i.unitCostMinor, currency)}</Td>
                    <Td>{menu(i)}</Td>
                  </AnimatedRow>
                ))}
              </tbody>
            </Table>
            <ul className="divide-y md:hidden">
              {items.data.items.map((i, idx) => (
                <AnimatedItem
                  key={i.id}
                  index={idx}
                  animate={animate}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{i.sku}</p>
                  </div>
                  <StockLevel item={i} />
                  {menu(i)}
                </AnimatedItem>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={25}
              total={items.data.total}
              onPage={(p) => setUrl({ page: String(p) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "new" ? "Add stock item" : "Edit stock item"}
        description={editing === "new" ? undefined : "Change the quantity here after a stocktake."}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {editing !== null && (
          <InventoryForm
            item={editing === "new" ? undefined : editing}
            currency={currency}
            onPendingChange={setSaving}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "item"}?`}
        description="Items already used on jobs can't be deleted (their history is kept). Set the quantity to 0 instead."
        confirmLabel="Delete item"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${deleting.name} deleted`);
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function StockLevel({ item }: { item: InventoryItemDto }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-sm tabular-nums",
        item.quantity === 0
          ? "bg-destructive/10 text-destructive"
          : item.lowStock
            ? "bg-status-en-route/15 text-foreground"
            : "",
      )}
    >
      {item.lowStock && <span className="sr-only">Low stock:</span>}
      {item.quantity}
    </span>
  );
}

function InventoryForm({
  item,
  currency,
  onDone,
  onPendingChange,
}: {
  item?: InventoryItemDto;
  currency: string;
  onDone: () => void;
  onPendingChange: (p: boolean) => void;
}) {
  const save = useSaveInventoryItem();
  const form = useForm<InventoryItemInput, unknown, InventoryItemData>({
    resolver: zodResolver(inventoryItemInputSchema),
    defaultValues: {
      name: item?.name ?? "",
      sku: item?.sku ?? "",
      quantity: item?.quantity ?? 0,
      reorderThreshold: item?.reorderThreshold ?? 0,
      unitCostMinor: item?.unitCostMinor ?? 0,
    },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (data) => {
    onPendingChange(true);
    try {
      await save.mutateAsync({ id: item?.id, data });
      toast.success(item ? "Item updated" : "Item added");
      onDone();
    } catch (e) {
      handleFormError(e, form.setError, ["name", "sku", "quantity", "reorderThreshold", "unitCostMinor"]);
    } finally {
      onPendingChange(false);
    }
  });

  return (
    <form id={FORM_ID} onSubmit={onSubmit} className="space-y-5" noValidate>
      <FieldGroup>
        <Field label="Name" required error={errors.name?.message}>
          <Input autoFocus {...form.register("name")} />
        </Field>
        <Field label="SKU" required error={errors.sku?.message} hint="Stored in upper case">
          <Input className="font-mono uppercase" {...form.register("sku")} />
        </Field>
      </FieldGroup>
      <FieldGroup className="sm:grid-cols-3">
        <Field label="In stock" required error={errors.quantity?.message}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            className="font-mono"
            {...form.register("quantity")}
          />
        </Field>
        <Field label="Reorder at" error={errors.reorderThreshold?.message}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            className="font-mono"
            {...form.register("reorderThreshold")}
          />
        </Field>
        <Field label={`Unit cost (${currency})`} error={errors.unitCostMinor?.message}>
          <Controller
            control={form.control}
            name="unitCostMinor"
            render={({ field }) => (
              <Input
                ref={field.ref}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="font-mono"
                value={typeof field.value === "number" ? field.value / 100 : ""}
                onChange={(e) => field.onChange(e.target.value === "" ? 0 : toMinor(Number(e.target.value)))}
                onBlur={field.onBlur}
              />
            )}
          />
        </Field>
      </FieldGroup>
    </form>
  );
}
