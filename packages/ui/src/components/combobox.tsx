"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { forwardRef, useState } from "react";
import { cn } from "../lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
}

interface ComboboxProps {
  value: string | null;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  /** Server-side search: the parent fetches matching options. */
  search: string;
  onSearch: (q: string) => void;
  selectedLabel?: string;
  placeholder: string;
  emptyText: string;
  loading?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/** Searchable, keyboard-navigable picker (cmdk) for lists too long for a <select>. */
export const Combobox = forwardRef<HTMLButtonElement, ComboboxProps>(function Combobox(
  { value, onChange, options, search, onSearch, selectedLabel, placeholder, emptyText, loading, ...aria },
  ref,
) {
  const [open, setOpen] = useState(false);
  const label = options.find((o) => o.value === value)?.label ?? selectedLabel;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm shadow-xs",
            "transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none",
            "aria-[invalid=true]:border-destructive",
            !label && "text-muted-foreground",
          )}
          {...aria}
        >
          <span className="truncate">{label ?? placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-64 origin-[var(--radix-popover-content-transform-origin)] rounded-xl border bg-popover p-1 shadow-lg data-[state=open]:animate-[menu-in_150ms_var(--ease-out)]"
        >
          <Command shouldFilter={false} loop>
            <Command.Input
              value={search}
              onValueChange={onSearch}
              placeholder="Search…"
              className="h-9 w-full rounded-lg bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Command.List className="max-h-64 overflow-y-auto border-t pt-1">
              {loading && (
                <Command.Loading>
                  <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
                  </div>
                </Command.Loading>
              )}
              {!loading && (
                <Command.Empty className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                  {emptyText}
                </Command.Empty>
              )}
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={o.value}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm data-[selected=true]:bg-accent"
                >
                  <Check
                    className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="font-mono text-xs text-muted-foreground">{o.hint}</span>}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
});
