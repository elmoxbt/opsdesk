"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

/** Light or dark, chosen explicitly (no "follow the system" option). */
const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Anyone who saved "system" before the option was removed lands on light.
  useEffect(() => {
    if (mounted && theme !== "light" && theme !== "dark") setTheme("light");
  }, [mounted, theme, setTheme]);

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex rounded-lg border bg-card p-0.5 shadow-xs"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              "grid size-8 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-foreground",
              active && "bg-accent text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
