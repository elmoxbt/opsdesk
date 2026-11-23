import { z } from "zod";
import { paginationQuerySchema } from "./common";

export const auditListQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
