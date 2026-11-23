import type { JobStatus } from "./constants";

/**
 * Statuses that occupy a technician's time. Two jobs in these statuses may not
 * overlap for the same technician (enforced by the API and by a Postgres
 * exclusion constraint). REQUESTED jobs are tentative; COMPLETED/CANCELLED are done.
 */
export const BLOCKING_STATUSES: readonly JobStatus[] = ["SCHEDULED", "EN_ROUTE", "IN_PROGRESS"];

export interface TimeSlot {
  start: Date | string;
  end: Date | string;
}

const ms = (d: Date | string) => (typeof d === "string" ? Date.parse(d) : d.getTime());

/** Half-open intervals [start, end): back-to-back jobs (10:00–11:00, 11:00–12:00) do NOT overlap. */
export function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

export interface SchedulableJob {
  id: string;
  status: JobStatus;
  technicianId: string | null;
  scheduledStart: Date | string | null;
  scheduledEnd: Date | string | null;
}

/** Other jobs that would clash with `candidate` (same technician, overlapping, blocking status). */
export function findConflicts<T extends SchedulableJob>(
  candidate: { id: string; technicianId: string; start: Date | string; end: Date | string },
  others: readonly T[],
): T[] {
  return others.filter(
    (o) =>
      o.id !== candidate.id &&
      o.technicianId === candidate.technicianId &&
      BLOCKING_STATUSES.includes(o.status) &&
      o.scheduledStart !== null &&
      o.scheduledEnd !== null &&
      overlaps(candidate, { start: o.scheduledStart, end: o.scheduledEnd }),
  );
}
