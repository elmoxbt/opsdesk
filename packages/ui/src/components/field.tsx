"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import { cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from "react";
import { cn } from "../lib/utils";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** A single input-like element; Field wires id / aria-invalid / aria-describedby onto it. */
  children: ReactElement<Record<string, unknown>>;
}

/** Label + control + hint/error, with the ARIA links screen readers need. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <LabelPrimitive.Root htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            {" "}
            *
          </span>
        )}
      </LabelPrimitive.Root>
      {isValidElement(children)
        ? cloneElement(children, {
            id,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": describedBy,
            "aria-required": required,
          })
        : children}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</div>;
}
