import { describe, expect, it } from "vitest";
import { JOB_STATUSES, type JobStatus } from "./constants";
import { availableTransitions, checkTransition, JOB_TRANSITIONS } from "./job-state-machine";

const owner = { id: "owner", role: "OWNER" as const };
const tech = { id: "tech-1", role: "TECHNICIAN" as const };
const scheduledJob = {
  technicianId: "tech-1",
  scheduledStart: "2026-01-01T09:00:00Z",
  scheduledEnd: "2026-01-01T10:00:00Z",
};
const bareJob = { technicianId: null, scheduledStart: null, scheduledEnd: null };

describe("JOB_TRANSITIONS", () => {
  it("defines every status, and terminal states have no exits", () => {
    expect(Object.keys(JOB_TRANSITIONS).sort()).toEqual([...JOB_STATUSES].sort());
    expect(JOB_TRANSITIONS.PAID).toEqual([]);
    expect(JOB_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("never allows a transition to the same status", () => {
    for (const s of JOB_STATUSES) expect(JOB_TRANSITIONS[s]).not.toContain(s);
  });
});

describe("checkTransition", () => {
  it("allows the happy path for a dispatcher/technician", () => {
    const steps: Array<[JobStatus, JobStatus, typeof owner | typeof tech]> = [
      ["REQUESTED", "SCHEDULED", owner],
      ["SCHEDULED", "EN_ROUTE", tech],
      ["EN_ROUTE", "IN_PROGRESS", tech],
      ["IN_PROGRESS", "COMPLETED", tech],
    ];
    for (const [from, to, actor] of steps) {
      expect(checkTransition({ from, to, actor, job: scheduledJob })).toEqual({ ok: true });
    }
  });

  it.each<[JobStatus, JobStatus]>([
    ["REQUESTED", "COMPLETED"],
    ["COMPLETED", "IN_PROGRESS"],
    ["CANCELLED", "SCHEDULED"],
    ["PAID", "CANCELLED"],
    ["IN_PROGRESS", "CANCELLED"],
  ])("rejects %s → %s", (from, to) => {
    expect(checkTransition({ from, to, actor: owner, job: scheduledJob, reason: "r" })).toMatchObject({
      ok: false,
      code: "INVALID_TRANSITION",
    });
  });

  it("requires technician and time to schedule", () => {
    expect(checkTransition({ from: "REQUESTED", to: "SCHEDULED", actor: owner, job: bareJob })).toMatchObject(
      {
        code: "PRECONDITION_FAILED",
      },
    );
  });

  it("requires a reason to cancel", () => {
    expect(
      checkTransition({ from: "SCHEDULED", to: "CANCELLED", actor: owner, job: scheduledJob, reason: " " }),
    ).toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("technicians can only progress their own jobs, and cannot schedule or cancel", () => {
    const other = { ...scheduledJob, technicianId: "tech-2" };
    expect(checkTransition({ from: "SCHEDULED", to: "EN_ROUTE", actor: tech, job: other })).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      checkTransition({ from: "REQUESTED", to: "SCHEDULED", actor: tech, job: scheduledJob }),
    ).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      checkTransition({ from: "SCHEDULED", to: "CANCELLED", actor: tech, job: scheduledJob, reason: "r" }),
    ).toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("INVOICED and PAID are system-only", () => {
    expect(
      checkTransition({ from: "COMPLETED", to: "INVOICED", actor: owner, job: scheduledJob }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      checkTransition({ from: "COMPLETED", to: "INVOICED", actor: "SYSTEM", job: scheduledJob }),
    ).toEqual({ ok: true });
  });
});

describe("availableTransitions", () => {
  it("lists actions for the actor, including ones blocked only by preconditions", () => {
    expect(availableTransitions("REQUESTED", owner, bareJob)).toEqual(["SCHEDULED", "CANCELLED"]);
    expect(availableTransitions("SCHEDULED", tech, scheduledJob)).toEqual(["EN_ROUTE"]);
    expect(availableTransitions("COMPLETED", owner, scheduledJob)).toEqual([]);
  });
});
