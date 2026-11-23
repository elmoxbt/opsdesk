import type { DispatchBoardDto, JobDto } from "@opsdesk/shared";
import { overlaps } from "@opsdesk/shared";

/**
 * Put the latest version of a job where it belongs on a board snapshot:
 * the time grid, the "to schedule" tray, or nowhere (cancelled / out of range).
 * Pure, so optimistic drops and realtime events share it, and it's unit-tested.
 * A stale copy (lower version than what's shown) is ignored, so a late event
 * can't overwrite a newer optimistic move.
 */
export function upsertJobInBoard(
  board: DispatchBoardDto,
  job: JobDto,
  range: { from: string; to: string },
): DispatchBoardDto {
  const existing = board.jobs.find((j) => j.id === job.id) ?? board.unscheduled.find((j) => j.id === job.id);
  if (existing && existing.version > job.version) return board;

  const jobs = board.jobs.filter((j) => j.id !== job.id);
  const unscheduled = board.unscheduled.filter((j) => j.id !== job.id);

  if (job.status === "REQUESTED" && (!job.technician || !job.scheduledStart)) {
    unscheduled.push(job);
  } else if (
    job.technician &&
    job.status !== "CANCELLED" &&
    job.scheduledStart &&
    job.scheduledEnd &&
    overlaps({ start: job.scheduledStart, end: job.scheduledEnd }, { start: range.from, end: range.to })
  ) {
    jobs.push(job);
    jobs.sort((a, b) => (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? ""));
  }
  return { ...board, jobs, unscheduled };
}
