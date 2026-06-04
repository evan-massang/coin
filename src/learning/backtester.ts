import type { ScoreBreakdown } from "../types.js";
import { decide, type DecisionThresholds } from "../scoring/decisionCaps.js";
import { buildDefaultLadder } from "../engine/exitEngine.js";

// §1.13 Backtester. Replays journalled signals under alternative thresholds:
// re-derive the verdict from stored sub-scores, then simulate the profit-ladder
// PnL from the recorded peak (maxGainPct). Pure + deterministic. This is how a
// threshold change is validated BEFORE it is applied.

export interface HistSignal {
  scores: ScoreBreakdown;
  safetyPass: boolean;
  unknownCount: number;
  /** Peak % gain after the alert (the journalled price path). */
  maxGainPct?: number;
  maxDrawdownPct?: number;
  holdMs?: number;
}

export interface BacktestResult {
  trades: number;
  winRate: number;
  totalPnlSol: number;
  maxDrawdownPct: number;
  bestTradePct: number;
  worstTradePct: number;
  avgHoldMs: number;
}

/** Fraction of a 1-SOL notional that the default ladder captures given a peak multiple. */
export function ladderCapture(peakMultiple: number, trailingStopPct = 0.35): number {
  const ladder = buildDefaultLadder();
  let captured = 0;
  let remaining = 1;
  for (const rung of ladder) {
    if (peakMultiple >= rung.multiple) {
      captured += rung.sellPct * rung.multiple;
      remaining -= rung.sellPct;
    }
  }
  // The unsold remainder (runner + any rungs not reached) exits via the trailing
  // stop: it gives back `trailingStopPct` of the peak.
  captured += remaining * Math.max(0, peakMultiple) * (1 - trailingStopPct);
  return captured;
}

export function runBacktest(
  signals: HistSignal[],
  thresholds: DecisionThresholds,
  notionalSol = 1,
): BacktestResult {
  let trades = 0;
  let wins = 0;
  let totalPnlSol = 0;
  let bestTradePct = -Infinity;
  let worstTradePct = Infinity;
  let worstDrawdown = 0;
  let holdSum = 0;
  let holdN = 0;

  for (const s of signals) {
    const d = decide({
      mint: "bt",
      scores: s.scores,
      safety: { pass: s.safetyPass, stage: 1, checks: [], unknownCount: s.unknownCount, fatalReasons: [], score: s.scores.safety },
      thresholds,
      at: 0,
    });
    if (d.verdict !== "BUY_SMALL" && d.verdict !== "BUY_STRONG") continue;

    trades++;
    const peakMultiple = 1 + (s.maxGainPct ?? 0) / 100;
    const captured = ladderCapture(peakMultiple);
    const tradePnlPct = (captured - 1) * 100;
    totalPnlSol += (captured - 1) * notionalSol;
    if (tradePnlPct > 0) wins++;
    bestTradePct = Math.max(bestTradePct, tradePnlPct);
    worstTradePct = Math.min(worstTradePct, tradePnlPct);
    worstDrawdown = Math.max(worstDrawdown, s.maxDrawdownPct ?? 0);
    if (s.holdMs !== undefined) {
      holdSum += s.holdMs;
      holdN++;
    }
  }

  return {
    trades,
    winRate: trades ? wins / trades : 0,
    totalPnlSol,
    maxDrawdownPct: worstDrawdown,
    bestTradePct: trades ? bestTradePct : 0,
    worstTradePct: trades ? worstTradePct : 0,
    avgHoldMs: holdN ? holdSum / holdN : 0,
  };
}
