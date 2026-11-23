import type { Metadata } from "next";
import { Suspense } from "react";
import { TableSkeleton } from "@opsdesk/ui/table";
import { QuotesView } from "./quotes-view";

export const metadata: Metadata = { title: "Quotes" };

export default function QuotesPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <QuotesView />
    </Suspense>
  );
}
