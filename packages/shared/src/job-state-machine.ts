import type { JobStatus, Role } from "./constants";

/**
 * Job lifecycle, defined once and shared: the API enforces it, and the UI uses
 * the same rules to show only the actions that will succeed.
 *
 *   REQUESTED ⇄ SCHEDULED → EN_ROUTE → IN_PROGRESS → COMPLETED → INVOICED → PAID
 *        └──────────┴───────────┴──→ CANCELLED
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  REQUESTED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["EN_ROUTE", "REQUESTED", "CANCELLED"],
  EN_ROUTE: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["INVOICED"],
  INVOICED: ["PAID"],
  PAID: [],
  CANCELLED: [],
};

/** Who may move a job INTO each status. `null` = system only (set by invoicing/payment flows). */
const ALLOWED_ROLES: Readonly<Record<JobStatus, readonly Role[] | null>> = {
  REQUESTED: ["OWNER", "DISPATCHER"],
  SCHEDULED: ["OWNER", "DISPATCHER"],
  EN_ROUTE: ["OWNER", "DISPATCHER", "TECHNICIAN"],
  IN_PROGRESS: ["OWNER", "DISPATCHER", "TECHNICIAN"],
  COMPLETED: ["OWNER", "DISPATCHER", "TECHNICIAN"],
  CANCELLED: ["OWNER", "DISPATCHER"],
  INVOICED: null,
  PAID: null,
};

export const TRANSITION_LABELS: Readonly<Record<JobStatus, string>> = {
  REQUESTED: "Unschedule",
  SCHEDULED: "Schedule",
  EN_ROUTE: "Mark en route",
  IN_PROGRESS: "Start job",
  COMPLETED: "Complete job",
  CANCELLED: "Cancel job",
  INVOICED: "Mark invoiced",
  PAID: "Mark paid",
};

/** Past-tense confirmations for toasts. */
export const TRANSITION_DONE: Readonly<Record<JobStatus, string>> = {
  REQUESTED: "Job unscheduled",
  SCHEDULED: "Job scheduled",
  EN_ROUTE: "Marked en route",
  IN_PROGRESS: "Job started",
  COMPLETED: "Job completed",
  CANCELLED: "Job cancelled",
  INVOICED: "Job invoiced",
  PAID: "Payment recorded",
};

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["SCHEDULED", "EN_ROUTE", "IN_PROGRESS"];
/** Schedule/technician may only be edited before the technician sets off. */
export const SCHEDULE_EDITABLE_STATUSES: readonly JobStatus[] = ["REQUESTED", "SCHEDULED"];

export interface TransitionInput {
  from: JobStatus;
  to: JobStatus;
  actor: { id: string; role: Role } | "SYSTEM";
  job: {
    technicianId: string | null;
    scheduledStart: Date | string | null;
    scheduledEnd: Date | string | null;
  };
  reason?: string | null;
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; code: "INVALID_TRANSITION" | "FORBIDDEN" | "PRECONDITION_FAILED"; message: string };

/** Pure check; the API calls this inside the transaction, the UI calls it to render buttons. */
export function checkTransition({ from, to, actor, job, reason }: TransitionInput): TransitionResult {
  if (!JOB_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `A ${label(from)} job cannot become ${label(to)}`,
    };
  }

  if (actor !== "SYSTEM") {
    const roles = ALLOWED_ROLES[to];
    if (!roles || !roles.includes(actor.role)) {
      return { ok: false, code: "FORBIDDEN", message: "You do not have permission to make this change" };
    }
    if (actor.role === "TECHNICIAN" && job.technicianId !== actor.id) {
      return { ok: false, code: "FORBIDDEN", message: "This job is assigned to another technician" };
    }
  }

  if (to === "SCHEDULED" && (!job.technicianId || !job.scheduledStart || !job.scheduledEnd)) {
    return {
      ok: false,
      code: "PRECONDITION_FAILED",
      message: "Assign a technician and a time before scheduling",
    };
  }
  if (to === "CANCELLED" && !reason?.trim()) {
    return { ok: false, code: "PRECONDITION_FAILED", message: "A cancellation reason is required" };
  }
  return { ok: true };
}

/** Statuses this actor could move the job to right now (ignores preconditions so the UI can explain them). */
export function availableTransitions(
  from: JobStatus,
  actor: { id: string; role: Role },
  job: TransitionInput["job"],
): JobStatus[] {
  return JOB_TRANSITIONS[from].filter((to) => {
    const r = checkTransition({ from, to, actor, job, reason: "x" });
    return r.ok || r.code === "PRECONDITION_FAILED";
  });
}

const label = (s: JobStatus) => s.toLowerCase().replace("_", " ");
