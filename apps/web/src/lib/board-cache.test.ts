import type { DispatchBoardDto, JobDto } from "@opsdesk/shared";
import { describe, expect, it } from "vitest";
import { upsertJobInBoard } from "./board-cache";

const range = { from: "2026-11-18T00:00:00Z", to: "2026-11-19T00:00:00Z" };
const tech = { id: "t1", name: "Chidi", avatarUrl: null };
const job = (over: Partial<JobDto>): JobDto =>
  ({
    id: "j1",
    number: 1,
    status: "SCHEDULED",
    technician: tech,
    scheduledStart: "2026-11-18T09:00:00Z",
    scheduledEnd: "2026-11-18T10:00:00Z",
    version: 2,
    ...over,
  }) as JobDto;
const empty: DispatchBoardDto = { technicians: [tech], jobs: [], unscheduled: [] };

describe("upsertJobInBoard", () => {
  it("moves a newly scheduled job from the tray to the grid", () => {
    const before = {
      ...empty,
      unscheduled: [job({ status: "REQUESTED", technician: null, scheduledStart: null, version: 1 })],
    };
    const after = upsertJobInBoard(before, job({}), range);
    expect(after.unscheduled).toEqual([]);
    expect(after.jobs.map((j) => j.id)).toEqual(["j1"]);
  });

  it("drops cancelled and out-of-range jobs from the grid", () => {
    const before = { ...empty, jobs: [job({})] };
    expect(upsertJobInBoard(before, job({ status: "CANCELLED", version: 3 }), range).jobs).toEqual([]);
    expect(
      upsertJobInBoard(
        before,
        job({ scheduledStart: "2026-11-20T09:00:00Z", scheduledEnd: "2026-11-20T10:00:00Z", version: 3 }),
        range,
      ).jobs,
    ).toEqual([]);
  });

  it("ignores a stale event older than what's displayed", () => {
    const before = {
      ...empty,
      jobs: [
        job({ version: 5, scheduledStart: "2026-11-18T14:00:00Z", scheduledEnd: "2026-11-18T15:00:00Z" }),
      ],
    };
    expect(upsertJobInBoard(before, job({ version: 4 }), range)).toBe(before);
  });
});
