import { describe, it, expect } from "vitest";
import { computeRisk } from "./microfishRisk.js";
import type { RiskContext } from "./riskTypes.js";
import { emptyScores } from "../types.js";

// Hermes Phase 15 invariant guard: provider-suggested ("Manus") sizing is an
// ADVISORY MULTIPLIER only. It can never push a position past the user's
// [minRiskPct, maxRiskPct] rails, and it never applies at all unless the verdict
// is already a BUY that cleared the safety + conviction gates. computeRisk is the
// single chokepoint, so pinning it here pins the whole sizing invariant.

function ctx(over: Partial<RiskContext> = {}): RiskContext {
  return {
    verdict: "BUY_STRONG",
    conviction: 90,
    scores: { ...emptyScores(), organic: 100, momentum: 100 },
    safetyPass: true,
    unknownCount: 0,
    honeypot: false,
    liquidityUsd: 1_000_000,
    minLiquidityUsd: 3_000,
    // Absurdly large multipliers — stands in for a provider trying to size up.
    marketWeatherMultiplier: 5,
    sourceAgreementMultiplier: 5,
    scamMemoryMultiplier: 5,
    baseRiskPct: 10,
    maxRiskPct: 2,
    minRiskPct: 0.1,
    maxPositionSol: 1,
    ...over,
  };
}

describe("computeRisk — sizing rails (advisory sizing can never breach them)", () => {
  it("never exceeds maxRiskPct no matter how large the multipliers are", () => {
    const r = computeRisk(ctx());
    expect(r.suggestedRiskPct).toBeLessThanOrEqual(2);
  });

  it("returns NONE / 0% for a non-BUY verdict (no sizing without a BUY)", () => {
    const r = computeRisk(ctx({ verdict: "WATCH_ONLY" }));
    expect(r.riskTier).toBe("NONE");
    expect(r.suggestedRiskPct).toBe(0);
  });

  it("returns NONE / 0% when the safety gate failed", () => {
    const r = computeRisk(ctx({ safetyPass: false }));
    expect(r.riskTier).toBe("NONE");
    expect(r.suggestedRiskPct).toBe(0);
  });

  it("returns NONE / 0% for a honeypot", () => {
    const r = computeRisk(ctx({ honeypot: true }));
    expect(r.riskTier).toBe("NONE");
    expect(r.suggestedRiskPct).toBe(0);
  });
});
