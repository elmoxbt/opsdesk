import { describe, expect, it } from "vitest";
import { directionsUrl, nextAction, telUrl } from "./next-action";

describe("nextAction", () => {
  it("walks a job forward, with completion as its own step (it needs a signature)", () => {
    expect(nextAction("SCHEDULED")).toMatchObject({ type: "transition", to: "EN_ROUTE" });
    expect(nextAction("EN_ROUTE")).toMatchObject({ type: "transition", to: "IN_PROGRESS" });
    expect(nextAction("IN_PROGRESS")).toMatchObject({ type: "complete" });
  });

  it("has nothing for finished or cancelled jobs", () => {
    for (const s of ["COMPLETED", "INVOICED", "PAID", "CANCELLED", "REQUESTED"] as const)
      expect(nextAction(s)).toBeNull();
  });
});

describe("links", () => {
  it("builds directions and tel links safely", () => {
    expect(directionsUrl("14 Admiralty Way, Lekki")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=14%20Admiralty%20Way%2C%20Lekki",
    );
    expect(telUrl("+234 (803) 555-0101")).toBe("tel:+2348035550101");
  });
});
