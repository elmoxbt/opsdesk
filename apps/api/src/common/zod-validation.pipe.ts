import { type PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { AppException } from "./app-exception";

/**
 * Validates a request part with a shared Zod schema (the same one the frontend
 * form uses) and returns the parsed, typed, normalised value.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join(".") : "_root";
      (details[key] ??= []).push(issue.message);
    }
    throw new AppException("VALIDATION_FAILED", "Request validation failed", details);
  }
}
