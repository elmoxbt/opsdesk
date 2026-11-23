import { z } from "zod";

const MAX_RANGE_DAYS = 14;

export const boardQuerySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((v) => v.to > v.from, { message: "`to` must be after `from`", path: ["to"] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, {
    message: `Range can be at most ${MAX_RANGE_DAYS} days`,
    path: ["to"],
  });
export type BoardQuery = z.infer<typeof boardQuerySchema>;

/**
 * The dispatch board's one command: put this job on this technician at this time.
 * A REQUESTED job becomes SCHEDULED in the same transaction.
 */
export const scheduleJobSchema = z
  .object({
    technicianId: z.uuid("Choose a technician"),
    scheduledStart: z.coerce.date(),
    /** Omit to keep the job's current duration (or the service default). */
    scheduledEnd: z.coerce.date().optional(),
    version: z.int().min(1),
  })
  .refine((v) => !v.scheduledEnd || v.scheduledEnd > v.scheduledStart, {
    message: "End must be after start",
    path: ["scheduledEnd"],
  });
export type ScheduleJobInput = z.input<typeof scheduleJobSchema>;
export type ScheduleJobData = z.output<typeof scheduleJobSchema>;
