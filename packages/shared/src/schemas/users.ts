import { z } from "zod";
import { roleSchema } from "./auth";
import { paginationQuerySchema } from "./common";

export const userListQuerySchema = paginationQuerySchema.extend({
  role: roleSchema.optional(),
  active: z.stringbool().optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;
