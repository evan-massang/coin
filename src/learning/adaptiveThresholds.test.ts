import { describe, it, expect } from "vitest";
import { clampAutoTune, suggestionsFromInsights } from "./adaptiveThresholds.js";
import { analyzePerformance } from "./performanceAnalyzer.js";
import { TUNABLE_KEYS } from "../store/settingsStore.js";
import type { FeatureRecord, Verdict } from "../types.js";
import { emptyScores } from "../types.js";

const RAILS = { maxDailyPct: 5, organicFloor: 40 };

describe("clampAutoTune rails (§1.12)", () => {
  it("limits a change to ≤5% of the current value per day", () => {
    const r = clampAutoTune("minOrganicScore", 55, 70, RAILS);
    expect(r.allowed).toBe(true);
    expect(r.to).toBe(58); // 55 + min(15, 2.75) = 57.75 → 58
  });

  it("never drops the organic score below the safe floor", () => {
    const r = clampAutoTune("minOrganicScore", 42, 30, RAILS);
    expect(r.to).toBeGreaterThanOrEqual(RAILS.organicFloor);
  });

  it("never auto-increases position size", () => {
    expect(clampAutoTune("paperMaxPositionSol", 1, 2, RAILS).allowed).toBe(false);
    expect(clampAutoTune("paperRiskPerTradePct", 3, 8, RAILS).allowed).toBe(false);
  });

  it("cannot step away from zero", () => {
    expect(clampAutoTune("weightSmartMoney", 0, 10, RAILS).allowed).toBe(false);
  });

  it("safety is never a tunable key (the gate can't be auto-disabled)", () => {
    expect(TUNABLE_KEYS).not.toContain("organicFloor");
    expect(TUNABLE_KEYS.every((k) => !/safety|paper(Max|Risk)/i.test(k))).toBe(true);
  });
});

function buy(organic: number, gainPct: number, over: Partial<FeatureRecord> = {}): FeatureRecord {
  return {
    mint: "M",
    at: 0,
    verdict: "BUY_SMALL" as Verdict,
    scores: { ...emptyScores(), organic, lateEntryRisk: 20, smartMoney: 50, hype: 50 },
    maxGainPct: gainPct,
    source: "signal",
    ...over,
  };
}

describe("analyzePerformance → suggestions", () => {
  it("suggests raising min organic when low-organic BUYs lose", () => {
    const features: FeatureRecord[] = [
      ...Array.from({ length: 7 }, () => buy(45, 0)), // low organic, losers
      ...Array.from({ length: 7 }, () => buy(80, 200)), // high organic, winners
    ];
    const insights = analyzePerformance(features, {
      minOrganicScore: 55,
      maxLateEntryRisk: 70,
      weightHype: 5,
      weightSmartMoney: 18,
    });
    const raise = insights.find((i) => i.setting === "minOrganicScore");
    expect(raise).toBeTruthy();
    expect(raise!.to).toBeGreaterThan(55);

    const sugs = suggestionsFromInsights(insights, 1000);
    expect(sugs[0]!.status).toBe("pending");
  });

  it("emits nothing on too little data", () => {
    expect(analyzePerformance([buy(45, 0)], { minOrganicScore: 55, maxLateEntryRisk: 70, weightHype: 5, weightSmartMoney: 18 })).toHaveLength(0);
  });
});
