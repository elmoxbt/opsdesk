"use client";

import { useClientConfig } from "./client-config";
import { cn } from "../lib/utils";

/** The client's logo if configured, otherwise a brand-coloured mark with their app name. */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  const { appName, branding } = useClientConfig();
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      {branding.logoUrl ? (
        // Plain <img>: the logo URL is configurable per client and may be an SVG on any https host.
        <img src={branding.logoUrl} alt={withText ? "" : appName} className="h-7 w-auto" />
      ) : (
        <svg
          viewBox="0 0 32 32"
          className="size-7"
          role={withText ? undefined : "img"}
          aria-label={withText ? undefined : appName}
          aria-hidden={withText || undefined}
        >
          <rect width="32" height="32" rx="9" fill="var(--brand)" />
          <path
            d="M9 16.5 14 21l9-10"
            stroke="var(--brand-foreground)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {withText && <span className="truncate">{appName}</span>}
    </span>
  );
}
