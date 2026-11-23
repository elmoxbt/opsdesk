"use client";

import { useState } from "react";
import { initials } from "../lib/utils";
import { cn } from "../lib/utils";

const SIZES = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-12 text-sm" } as const;

/** Photo when available; initials on a deterministic tint as the fallback (also if the image fails). */
export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-medium select-none",
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: `oklch(0.92 0.05 ${hue})`, color: `oklch(0.35 0.08 ${hue})` }}
      aria-hidden
    >
      {src && !failed ? (
        // Plain <img>: avatars are tiny, remote and user-supplied, so next/image adds little here.
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
