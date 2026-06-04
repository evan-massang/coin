import { describe, it, expect } from "vitest";
import { computeSourceAgreement } from "./sourceAgreement.js";

const CONFLICT_MULT = 0.5;

describe("computeSourceAgreement", () => {
  it("corroborating sources ⇒ high score, no penalty", () => {
    const r = computeSourceAgreement({
      rugcheckClean: true,
      liquidityHealthy: true,
      momentumStrong: true,
      bundleBad: false,
      holderBad: false,
      sourceConflictMultiplier: CONFLICT_MULT,
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.confirmations.length).toBeGreaterThanOrEqual(2);
    expect(r.multiplier).toBeGreaterThanOrEqual(1);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("RugCheck clean but bundled trades ⇒ conflict ⇒ reduced multiplier", () => {
    const r = computeSourceAgreement({ rugcheckClean: true, bundleBad: true, sourceConflictMultiplier: CONFLICT_MULT });
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.multiplier).toBe(CONFLICT_MULT);
    expect(r.score).toBeLessThan(70);
  });

  it("healthy liquidity but concentrated holders ⇒ conflict", () => {
    const r = computeSourceAgreement({ liquidityHealthy: true, holderBad: true, sourceConflictMultiplier: CONFLICT_MULT });
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.multiplier).toBe(CONFLICT_MULT);
  });
});
