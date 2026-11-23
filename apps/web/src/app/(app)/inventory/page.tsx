import { getClientConfig } from "@opsdesk/client-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TableSkeleton } from "@opsdesk/ui/table";
import { InventoryView } from "./inventory-view";

export const metadata: Metadata = { title: "Inventory" };

/** The `inventory` feature: when a client has it off, this page doesn't exist. */
export default function InventoryPage() {
  if (!getClientConfig().features.inventory) notFound();
  return (
    <Suspense fallback={<TableSkeleton />}>
      <InventoryView />
    </Suspense>
  );
}
