"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { staggerDelay, transitions } from "../lib/motion";
import { cn } from "../lib/utils";
import { Skeleton } from "./skeleton";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "h-10 px-4 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

/**
 * Rows fade/slide in with a 30ms stagger, but only the first time data
 * appears: paging or refetching shouldn't replay the entrance.
 */
export function useFirstLoad(ready: boolean): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!ready || done) return;
    // After the capped stagger (10 x 30ms + duration) has played, stop animating new rows.
    const t = setTimeout(() => setDone(true), 600);
    return () => clearTimeout(t);
  }, [ready, done]);
  return ready && !done;
}

export function AnimatedRow({
  index,
  animate,
  className,
  ...props
}: React.ComponentProps<typeof motion.tr> & { index: number; animate: boolean }) {
  return (
    <motion.tr
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transitions.micro, delay: animate ? staggerDelay(index) : 0 }}
      className={cn("border-t transition-colors hover:bg-muted/50", className)}
      {...props}
    />
  );
}

export function AnimatedItem({
  index,
  animate,
  className,
  ...props
}: React.ComponentProps<typeof motion.li> & { index: number; animate: boolean }) {
  return (
    <motion.li
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transitions.micro, delay: animate ? staggerDelay(index) : 0 }}
      className={className}
      {...props}
    />
  );
}

/** Skeleton that matches the real layout (table on desktop, cards on mobile) so nothing jumps. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="hidden md:block">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-6 border-t px-4 py-4">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={cn("h-4", c === 0 ? "w-1/4" : "flex-1")} />
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-3 p-4 md:hidden">
        {Array.from({ length: Math.min(rows, 4) }, (_, r) => (
          <div key={r} className="space-y-2 rounded-lg border p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
