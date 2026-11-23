import { $Enums } from "@opsdesk/db";
import { ROLES } from "@opsdesk/shared";
import { describe, expect, it } from "vitest";

describe("role definitions", () => {
  it("shared ROLES match the Prisma Role enum (one cannot drift from the other)", () => {
    expect(Object.values($Enums.Role)).toEqual([...ROLES]);
  });
});
