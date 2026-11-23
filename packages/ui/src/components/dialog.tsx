"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { backdropVariants, modalVariants, transitions } from "../lib/motion";
import { cn } from "../lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Radix gives focus trapping, Esc, scroll lock and ARIA; Motion gives the
 * enter/exit animation (fade backdrop + 0.96→1 scale). `forceMount` hands
 * unmounting to AnimatePresence so the exit animation can play.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
                variants={backdropVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              />
            </DialogPrimitive.Overlay>
            <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
              <DialogPrimitive.Content
                asChild
                forceMount
                aria-describedby={description ? undefined : undefined}
              >
                <motion.div
                  variants={modalVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className={cn(
                    "relative w-full max-w-lg rounded-2xl border bg-popover text-popover-foreground shadow-lg focus:outline-none",
                    className,
                  )}
                >
                  <div className="space-y-1 px-6 pt-6">
                    <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
                      {title}
                    </DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description className="text-sm text-muted-foreground">
                        {description}
                      </DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
                    )}
                  </div>
                  <div className="px-6 py-5">{children}</div>
                  {footer && (
                    <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">
                      {footer}
                    </div>
                  )}
                  <DialogPrimitive.Close
                    className="absolute top-4 right-4 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Close"
                  >
                    <X className="size-4" />
                  </DialogPrimitive.Close>
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

interface SheetProps extends Omit<DialogProps, "className"> {
  side?: "right" | "left";
  className?: string;
}

/** Side drawer: same accessibility as Dialog, slides in from the edge. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
  className,
}: SheetProps) {
  const from = side === "right" ? "100%" : "-100%";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/40"
                variants={backdropVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                initial={{ x: from }}
                animate={{ x: 0, transition: transitions.page }}
                exit={{ x: from, transition: { duration: 0.25, ease: [0.4, 0, 1, 1] } }}
                className={cn(
                  "fixed inset-y-0 z-50 flex w-full max-w-md flex-col border-l bg-popover shadow-lg focus:outline-none",
                  side === "right" ? "right-0" : "left-0 border-r border-l-0",
                  className,
                )}
              >
                <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
                  <div className="space-y-1">
                    <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
                      {title}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description
                      className={description ? "text-sm text-muted-foreground" : "sr-only"}
                    >
                      {description ?? title}
                    </DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close
                    className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Close"
                  >
                    <X className="size-4" />
                  </DialogPrimitive.Close>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {footer && (
                  <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">
                    {footer}
                  </div>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
