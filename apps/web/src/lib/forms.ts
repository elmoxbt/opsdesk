import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ApiError, errorMessage } from "./api/client";

/**
 * Shows server-side validation errors next to the right fields (e.g. "email
 * already in use"), and anything else as a toast. Client and server share Zod
 * schemas, so field names line up.
 */
export function handleFormError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): void {
  if (err instanceof ApiError && err.details) {
    let matched = false;
    for (const [field, messages] of Object.entries(err.details)) {
      if (fields.includes(field)) {
        setError(field as Path<T>, { message: messages[0] });
        matched = true;
      }
    }
    if (matched) return;
  }
  toast.error(errorMessage(err));
}
