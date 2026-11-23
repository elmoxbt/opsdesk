import { z } from "zod";
import { JOB_STATUSES } from "../constants";
import { csvArray, optionalText, paginationQuerySchema, searchQuery } from "./common";

export const jobStatusSchema = z.enum(JOB_STATUSES);

export const checklistItemSchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().trim().min(1, "Required").max(200),
  done: z.boolean(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

const nullableDate = z.coerce
  .date()
  .nullish()
  .transform((v) => v ?? null);

/** Fields a dispatcher can edit. Status is NOT here: it only changes through transitions. */
const jobFields = z.object({
  serviceTypeId: z.uuid("Choose a service"),
  technicianId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  scheduledStart: nullableDate,
  /** Defaults to start + the service's duration when omitted. */
  scheduledEnd: nullableDate,
  notes: optionalText(2000),
  priceMinor: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .nullish()
    .transform((v) => v ?? null),
  checklist: z.array(checklistItemSchema).max(50).default([]),
});

const endAfterStart = (v: { scheduledStart: Date | null; scheduledEnd: Date | null }) =>
  !v.scheduledStart || !v.scheduledEnd || v.scheduledEnd > v.scheduledStart;
const endAfterStartIssue = { message: "End must be after start", path: ["scheduledEnd"] };

export const jobCreateSchema = jobFields
  .extend({ customerId: z.uuid("Choose a customer") })
  .refine(endAfterStart, endAfterStartIssue);
export type JobCreateInput = z.input<typeof jobCreateSchema>;
export type JobCreateData = z.output<typeof jobCreateSchema>;

/** Full replace of editable fields + optimistic-concurrency `version`. */
export const jobUpdateSchema = jobFields
  .extend({ version: z.int().min(1) })
  .refine(endAfterStart, endAfterStartIssue);
export type JobUpdateInput = z.input<typeof jobUpdateSchema>;
export type JobUpdateData = z.output<typeof jobUpdateSchema>;

export const jobTransitionSchema = z.object({
  to: jobStatusSchema,
  reason: optionalText(500),
  /** When provided, the transition fails with 409 if the job changed since the client loaded it. */
  version: z.int().min(1).optional(),
});
export type JobTransitionInput = z.input<typeof jobTransitionSchema>;

export const JOB_SORTS = ["-createdAt", "scheduledStart", "-scheduledStart"] as const;
export const jobListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery,
  status: csvArray(jobStatusSchema),
  /** A technician id, or "unassigned". */
  technicianId: z.union([z.uuid(), z.literal("unassigned")]).optional(),
  customerId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(JOB_SORTS).default("-createdAt"),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;
