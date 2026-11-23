import type { Metadata } from "next";
import { Suspense } from "react";
import { DispatchBoard } from "@/components/dispatch/dispatch-board";
import { Skeleton } from "@opsdesk/ui/skeleton";

export const metadata: Metadata = { title: "Dispatch" };

export default function DispatchPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem] rounded-xl" />}>
      <DispatchBoard />
    </Suspense>
  );
}
