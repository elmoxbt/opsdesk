import { cn } from "../lib/utils";

/** Shimmer placeholder used for every loading state (no spinners for data). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden rounded-md bg-muted", className)} {...props}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
    </div>
  );
}
