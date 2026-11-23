import { getClientConfig } from "@opsdesk/client-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { AnalyticsView } from "./analytics-view";

export const metadata: Metadata = { title: "Analytics" };

/** The `analytics` feature: when a client has it off, this page doesn't exist. */
export default function AnalyticsPage() {
  if (!getClientConfig().features.analytics) notFound();
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <AnalyticsView />
    </Suspense>
  );
}
