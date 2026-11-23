import type { Metadata } from "next";
import { Suspense } from "react";
import { TableSkeleton } from "@opsdesk/ui/table";
import { JobsView } from "./jobs-view";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <JobsView />
    </Suspense>
  );
}
