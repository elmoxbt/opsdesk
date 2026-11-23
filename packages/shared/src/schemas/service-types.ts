import { z } from "zod";
import { optionalText, paginationQuerySchema, searchQuery } from "./common";

export const serviceTypeInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: optionalText(500),
  defaultDurationMinutes: z.coerce
    .number()
    .int()
    .min(15, "At least 15 minutes")
    .max(24 * 60, "At most 24 hours"),
  /** Minor units (kobo/cents). */
  defaultPriceMinor: z.coerce.number().int().min(0, "Cannot be negative").max(1_000_000_000),
  isActive: z.boolean().default(true),
});
export type ServiceTypeInput = z.input<typeof serviceTypeInputSchema>;
export type ServiceTypeData = z.output<typeof serviceTypeInputSchema>;

export const serviceTypeListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery,
  includeInactive: z.stringbool().default(false),
});
export type ServiceTypeListQuery = z.infer<typeof serviceTypeListQuerySchema>;
