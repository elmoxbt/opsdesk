"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import { cn } from "../lib/utils";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = "end", ...props }: DM.DropdownMenuContentProps) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg",
          "origin-[var(--radix-dropdown-menu-content-transform-origin)] data-[state=open]:animate-[menu-in_150ms_var(--ease-out)]",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: DM.DropdownMenuItemProps & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-destructive data-[highlighted]:bg-destructive/10 [&_svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: DM.DropdownMenuSeparatorProps) => (
  <DM.Separator className={cn("my-1 h-px bg-border", className)} {...props} />
);

export const DropdownMenuLabel = ({ className, ...props }: DM.DropdownMenuLabelProps) => (
  <DM.Label className={cn("px-2.5 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />
);
