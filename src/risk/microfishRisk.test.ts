import { describe, it, expect } from "vitest";
import { computeRisk } from "./microfishRisk.js";
import type { RiskContext } from "./riskTypes.js";
import { emptyScores } from "../types.js";

function ctx(over: Partial<RiskContext> = {}): RiskContext {
  return {
    verdict: "BUY_STRONG",
    conviction: 80,
    scores: { ...emptyScores(), safety: 90, organic: 80, momentum: 85, lateEntryRisk: 10 },
    safetyPass: true,
    unknownCount: 0,
    liquidityUsd: 50_000,
    minLiquidityUsd: 3000,
    baseRiskPct: 1,
    maxRiskPct: 2,
    minRiskPct: 0.1,
    maxPositionSol: 1,
    ...over,
  };
}

describe("computeRisk (MicroFish)", () => {
  it("safety fail ⇒ 0% / NONE", () => {
    const r = computeRisk(ctx({ safetyPass: false }));
    expect(r.suggestedRiskPct).toBe(0);
    expect(r.riskTier).toBe("NONE");
  });

  it("honeypot ⇒ 0% / NONE", () => {
    expect(computeRisk(ctx({ honeypot: true })).suggestedRiskPct).toBe(0);
  });

  it("non-BUY verdict ⇒ 0% / NONE", () => {
    expect(computeRisk(ctx({ verdict: "WATCH_ONLY" })).riskTier).toBe("NONE");
  });

  it("clean + strong + risk-on ⇒ high tier", () => {
    const r = computeRisk(ctx({ marketWeatherMultiplier: 1.2 }));
    expect(r.suggestedRiskPct).toBeGreaterThanOrEqual(1.5);
    expect(r.riskTier).toBe("HIGH");
  });

  it("risk-off shrinks the size vs risk-on", () => {
    const on = computeRisk(ctx({ marketWeatherMultiplier: 1.2 }));
    const off = computeRisk(ctx({ marketWeatherMultiplier: 0.35 }));
    expect(off.suggestedRiskPct).toBeLessThan(on.suggestedRiskPct);
  });

  it("source conflict shrinks the size", () => {
    const agree = computeRisk(ctx({ sourceAgreementMultiplier: 1 }));
    const conflict = computeRisk(ctx({ sourceAgreementMultiplier: 0.5 }));
    expect(conflict.suggestedRiskPct).toBeLessThan(agree.suggestedRiskPct);
  });

  it("too-late ⇒ tiny size", () => {
    const strong = computeRisk(ctx({ scores: { ...emptyScores(), safety: 90, organic: 80, momentum: 85, lateEntryRisk: 10 } }));
    const late = computeRisk(ctx({ scores: { ...emptyScores(), safety: 90, organic: 80, momentum: 85, lateEntryRisk: 65 } }));
    expect(late.suggestedRiskPct).toBeLessThan(strong.suggestedRiskPct);
    expect(["NONE", "TINY", "LOW"]).toContain(late.riskTier);
  });
});
