import type { Metadata } from "next";
import { Suspense } from "react";
import { TableSkeleton } from "@opsdesk/ui/table";
import { InvoicesView } from "./invoices-view";

export const metadata: Metadata = { title: "Invoices" };

export default function InvoicesPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <InvoicesView />
    </Suspense>
  );
}
