/**
 * Single source of truth for roles on the TS side. The Prisma `Role` enum must
 * match this list; a unit test in @opsdesk/api asserts they stay in sync.
 */
export const ROLES = ["OWNER", "DISPATCHER", "TECHNICIAN"] as const;
export type Role = (typeof ROLES)[number];

/** Which roles a given role may invite. Owners are created only via signup. */
export const INVITABLE_ROLES: Record<Role, readonly Role[]> = {
  OWNER: ["DISPATCHER", "TECHNICIAN"],
  DISPATCHER: ["TECHNICIAN"],
  TECHNICIAN: [],
};

export const JOB_STATUSES = [
  "REQUESTED",
  "SCHEDULED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "COMPLETED",
  "INVOICED",
  "PAID",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const PASSWORD_MIN_LENGTH = 10;
export const INVITATION_TTL_HOURS = 72;
