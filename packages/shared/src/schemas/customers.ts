import { z } from "zod";
import { emailSchema } from "./auth";
import { optionalText, paginationQuerySchema, searchQuery } from "./common";

export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Enter a valid phone number")
  .max(20)
  .regex(/^\+?[\d\s()-]+$/, "Enter a valid phone number");

/** Full representation: used for create AND update (PUT), so omitted fields are never ambiguous. */
export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: phoneSchema,
  email: z
    .union([z.literal(""), emailSchema])
    .nullish()
    .transform((v) => v || null),
  address: optionalText(300),
  notes: optionalText(2000),
});
export type CustomerInput = z.input<typeof customerInputSchema>;
export type CustomerData = z.output<typeof customerInputSchema>;

export const CUSTOMER_SORTS = ["name", "-createdAt"] as const;
export const customerListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery,
  sort: z.enum(CUSTOMER_SORTS).default("name"),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
