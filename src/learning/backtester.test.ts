import { describe, it, expect } from "vitest";
import { runBacktest, backtestExits, exitOutcomeBounds, ladderCapture, type HistSignal } from "./backtester.js";
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

describe("exitOutcomeBounds (faithful, drawdown-aware)", () => {
  it("a pure loser (gain 0, dumps 90%) is capped by the stop-loss at -45%", () => {
    // No stop ⇒ rides to the trough (≈ -90%). With a 45% stop ⇒ exit at -45%.
    const noStop = exitOutcomeBounds(0, 90, {});
    const stopped = exitOutcomeBounds(0, 90, { stopLossPct: 0.45 });
    expect(noStop.optimistic).toBeCloseTo(0.1, 2); // ~10% of notional left
    expect(stopped.optimistic).toBeCloseTo(0.55, 2); // stop-loss saved ~45 points
    expect(stopped.pessimistic).toBeCloseTo(0.55, 2); // same both orderings: it only ever fell
  });

  it("ordering bounds diverge only when the stop is actually breached", () => {
    // Ran to 3x peak, gave back 20% (never near a 45% stop) ⇒ no divergence.
    const winner = exitOutcomeBounds(200, 20, { stopLossPct: 0.45 });
    expect(winner.optimistic).toBe(winner.pessimistic);
    expect(winner.optimistic).toBeGreaterThan(1.5); // laddered profit

    // Hit a 3.8x peak BUT also recorded a 74% drawdown: peak-first is a big win,
    // trough-first means the stop fired before the run ⇒ wide, honest range.
    const ambiguous = exitOutcomeBounds(280, 74, { stopLossPct: 0.45 });
    expect(ambiguous.optimistic).toBeGreaterThan(1.5);
    expect(ambiguous.pessimistic).toBeCloseTo(0.55, 2);
  });

  it("a clear winner is never cut by the stop (stop only looks below entry)", () => {
    const noStop = exitOutcomeBounds(300, 20, {});
    const withStop = exitOutcomeBounds(300, 20, { stopLossPct: 0.45 });
    expect(withStop.optimistic).toBe(noStop.optimistic);
  });

  it("backtestExits reports a PnL range and a stop-loss lifts the pessimistic floor", () => {
    const losers = Array.from({ length: 5 }, () => ({ ...strong(0), maxGainPct: 0, maxDrawdownPct: 85 }));
    const noStop = backtestExits(losers, LOOSE, {});
    const withStop = backtestExits(losers, LOOSE, { stopLossPct: 0.45 });
    expect(withStop.trades).toBe(5);
    expect(withStop.pnlOptimistic).toBeGreaterThan(noStop.pnlOptimistic); // losses cut
  });
});
