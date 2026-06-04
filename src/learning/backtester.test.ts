import { describe, it, expect } from "vitest";
import { runBacktest, ladderCapture, type HistSignal } from "./backtester.js";
import type { DecisionThresholds } from "../scoring/decisionCaps.js";
import { emptyScores } from "../types.js";

const WEIGHTS = { organic: 15, momentum: 30, graduation: 12, devReputation: 12, smartMoney: 18, social: 8, hype: 5 };
const LOOSE: DecisionThresholds = { minConvictionBuySmall: 55, minConvictionBuyStrong: 72, maxLateEntryRisk: 70, minOrganicScore: 55, weights: WEIGHTS };
const STRICT: DecisionThresholds = { ...LOOSE, minConvictionBuySmall: 85, minConvictionBuyStrong: 95 };

function strong(gainPct: number): HistSignal {
  return {
    scores: { ...emptyScores(), organic: 80, momentum: 90, graduation: 80, devReputation: 70, smartMoney: 80, social: 70, hype: 60, lateEntryRisk: 10 },
    safetyPass: true,
    unknownCount: 0,
    maxGainPct: gainPct,
    maxDrawdownPct: 20,
  };
}

describe("ladderCapture", () => {
  it("captures more as the peak multiple rises", () => {
    expect(ladderCapture(4)).toBeGreaterThan(ladderCapture(2));
    // A 4x peak: 40%@2x + 30%@3x captured, remainder trails out — net > 1.
    expect(ladderCapture(4)).toBeGreaterThan(1.5);
  });
});

describe("runBacktest", () => {
  it("counts BUYs as trades and accrues laddered PnL", () => {
    const signals = [strong(300), strong(150), strong(50)];
    const r = runBacktest(signals, LOOSE);
    expect(r.trades).toBe(3);
    expect(r.totalPnlSol).toBeGreaterThan(0);
    expect(r.bestTradePct).toBeGreaterThan(r.worstTradePct);
  });

  it("stricter conviction thresholds admit fewer trades (validate-before-apply)", () => {
    const signals = [strong(300), strong(150)];
    const loose = runBacktest(signals, LOOSE);
    const strict = runBacktest(signals, STRICT);
    expect(strict.trades).toBeLessThan(loose.trades);
  });

  it("a safety-failed signal is never a trade", () => {
    const failed: HistSignal = { ...strong(300), safetyPass: false, scores: { ...strong(300).scores, safety: 0 } };
    expect(runBacktest([failed], LOOSE).trades).toBe(0);
  });
});
