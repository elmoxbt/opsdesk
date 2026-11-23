"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, type PanInfo, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { backdropVariants, transitions } from "../lib/motion";
import { cn } from "../lib/utils";

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Mobile action sheet. Radix Dialog provides focus trap, Esc and screen-reader
 * semantics; Motion slides it up, and it can be dragged down to dismiss
 * (past 120px or a quick flick). The drag handle is a convenience: the Close
 * button and Esc always work too.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: BottomSheetProps) {
  const reduce = useReducedMotion();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onOpenChange(false);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/45"
                variants={backdropVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0, transition: transitions.spring }}
                exit={{ y: "100%", transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
                drag={reduce ? false : "y"}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={onDragEnd}
                className={cn(
                  "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl border-t bg-popover pb-[env(safe-area-inset-bottom)] shadow-lg focus:outline-none",
                  className,
                )}
              >
                <div className="flex justify-center pt-3 pb-1" aria-hidden>
                  <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
                </div>
                <div className="px-5 pb-3">
                  <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
                    {title}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description
                    className={description ? "text-sm text-muted-foreground" : "sr-only"}
                  >
                    {description ?? title}
                  </DialogPrimitive.Description>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
                {footer && <div className="flex flex-col gap-2 border-t px-5 py-3">{footer}</div>}
                <DialogPrimitive.Close className="sr-only">Close</DialogPrimitive.Close>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
