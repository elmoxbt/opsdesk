import type { Metadata } from "next";
import { Suspense } from "react";
import { TableSkeleton } from "@opsdesk/ui/table";
import { CustomersView } from "./customers-view";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <CustomersView />
    </Suspense>
  );
}
