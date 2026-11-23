import { describe, expect, it } from "vitest";
import { STAGGER_CAP, STAGGER_STEP, staggerDelay } from "./motion";

describe("staggerDelay", () => {
  it("steps 30ms per item", () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBeCloseTo(0.09);
  });

  it("caps at the 10th item so long lists don't lag", () => {
    expect(staggerDelay(250)).toBeCloseTo(STAGGER_CAP * STAGGER_STEP);
  });
});
