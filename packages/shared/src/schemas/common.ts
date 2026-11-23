import { z } from "zod";

export const uuidSchema = z.uuid();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Optional free text: trims, and turns "" / undefined into null (what forms send for an empty field). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Search box input: trimmed, empty means "no filter". */
export const searchQuery = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => v || undefined);

/** Accepts `?status=A&status=B` (array) or `?status=A,B` (string). */
export const csvArray = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(item).optional());
