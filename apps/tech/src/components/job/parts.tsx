"use client";

import { api, formatMoney, type InventoryItemDto, type JobPartDto, type Paginated } from "@opsdesk/shared";
import { BottomSheet } from "@opsdesk/ui/bottom-sheet";
import { Button } from "@opsdesk/ui/button";
import { Input } from "@opsdesk/ui/input";
import { cn } from "@opsdesk/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { CloudUpload, Minus, Package, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useSession } from "@/lib/session";
import { useSync } from "@/offline/sync-provider";
import type { OutboxEntry } from "@/offline/types";

/** Parts used on the job (the `inventory` feature). Stock is deducted by the server, atomically. */
export function PartsSection({ jobId, editable }: { jobId: string; editable: boolean }) {
  const me = useSession();
  const { entries, enqueue } = useSync();
  const [adding, setAdding] = useState(false);
  const parts = useQuery({
    queryKey: ["parts", jobId],
    queryFn: () => api<JobPartDto[]>(`/jobs/${jobId}/parts`),
  });

  const pendingAdds = entries.filter(
    (e): e is Extract<OutboxEntry, { kind: "addPart" }> => e.kind === "addPart" && e.jobId === jobId,
  );
  const pendingRemovals = new Set(
    entries
      .filter((e) => e.kind === "removePart" && e.jobId === jobId)
      .map((e) => (e as { partId: string }).partId),
  );
  const rows = [
    ...(parts.data ?? [])
      .filter((p) => !pendingRemovals.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.item.name,
        sku: p.item.sku,
        quantity: p.quantity,
        cost: p.unitCostMinor,
        waiting: false,
      })),
    ...pendingAdds.map((p) => ({
      id: p.partId,
      name: p.itemName,
      sku: "",
      quantity: p.quantity,
      cost: null,
      waiting: true,
    })),
  ];

  return (
    <section aria-labelledby="parts" className="rounded-2xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="parts" className="font-semibold">
          Parts used
        </h2>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          No parts recorded{editable ? "." : " for this job."}
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-12 items-center gap-3">
              <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.waiting ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <CloudUpload className="size-3" aria-hidden /> Waiting to sync
                    </span>
                  ) : (
                    <>
                      <span className="font-mono">{r.sku}</span>
                      {r.cost !== null && <> · {formatMoney(r.cost, me.organization.currency)} each</>}
                    </>
                  )}
                </p>
              </div>
              <span className="font-mono text-sm tabular-nums">×{r.quantity}</span>
              {editable && !r.waiting && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${r.name}`}
                  onClick={() => void enqueue({ kind: "removePart", jobId, partId: r.id })}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddPartSheet
        open={adding}
        onOpenChange={setAdding}
        onAdd={async (item, quantity) => {
          await enqueue({
            kind: "addPart",
            jobId,
            partId: crypto.randomUUID(),
            inventoryItemId: item.id,
            itemName: item.name,
            quantity,
          });
          setAdding(false);
        }}
      />
    </section>
  );
}

function AddPartSheet({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (item: InventoryItemDto, quantity: number) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<InventoryItemDto | null>(null);
  const [quantity, setQuantity] = useState(1);
  // The whole catalogue is cached (and persisted), so picking parts works offline.
  const inventory = useQuery({
    queryKey: ["inventory"],
    queryFn: () => api<Paginated<InventoryItemDto>>("/inventory-items", { query: { pageSize: 100 } }),
  });
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (inventory.data?.items ?? []).filter(
      (i) => !needle || i.name.toLowerCase().includes(needle) || i.sku.toLowerCase().includes(needle),
    );
  }, [inventory.data, q]);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setPicked(null);
          setQuantity(1);
          setQ("");
        }
      }}
      title={picked ? picked.name : "Add a part"}
      description={picked ? `${picked.quantity} in stock (as of last sync)` : "Search the stock list"}
      footer={
        picked && (
          <Button size="lg" className="h-12 w-full" onClick={() => void onAdd(picked, quantity)}>
            Add {quantity} × {picked.name}
          </Button>
        )
      }
    >
      {picked ? (
        <div className="flex items-center justify-center gap-6 py-6">
          <Button
            size="icon"
            variant="outline"
            className="size-12"
            aria-label="One fewer"
            onClick={() => setQuantity((n) => Math.max(1, n - 1))}
          >
            <Minus aria-hidden />
          </Button>
          <output
            aria-live="polite"
            className="w-16 text-center font-mono text-3xl font-semibold tabular-nums"
          >
            {quantity}
          </output>
          <Button
            size="icon"
            variant="outline"
            className="size-12"
            aria-label="One more"
            onClick={() => setQuantity((n) => Math.min(999, n + 1))}
          >
            <Plus aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              placeholder="Name or SKU"
              aria-label="Search parts"
              className="h-11 pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setPicked(i)}
                  className="flex min-h-12 w-full items-center gap-3 py-2 text-left active:bg-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{i.sku}</span>
                  </span>
                  <span
                    className={cn(
                      "font-mono text-sm tabular-nums",
                      i.quantity === 0 ? "text-destructive" : i.lowStock && "text-status-en-route",
                    )}
                  >
                    {i.quantity}
                  </span>
                </button>
              </li>
            ))}
            {inventory.isSuccess && items.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">No matching parts.</li>
            )}
          </ul>
        </div>
      )}
    </BottomSheet>
  );
}
