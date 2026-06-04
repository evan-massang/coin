import { runBacktest, type HistSignal, type BacktestResult } from "../learning/backtester.js";
import type { ReplayEvent } from "./eventRecorder.js";
import { LEAGUE_STRATEGIES, type Strategy } from "./strategyLeague.js";

// Deterministic replay: re-run recorded events through each strategy's
// thresholds (reusing the pure backtester). Same events ⇒ same results.

export interface StrategyReplayResult extends BacktestResult {
  name: string;
}

function toHist(e: ReplayEvent): HistSignal {
  return {
    scores: e.scores,
    safetyPass: e.safetyPass,
    unknownCount: e.unknownCount,
    maxGainPct: e.maxGainPct,
    maxDrawdownPct: e.maxDrawdownPct,
    holdMs: e.holdMs,
  };
}

export function replayStrategies(events: ReplayEvent[], strategies: Strategy[] = LEAGUE_STRATEGIES): StrategyReplayResult[] {
  const hist = events.map(toHist);
  return strategies.map((s) => ({ name: s.name, ...runBacktest(hist, s.thresholds) }));
}

export function rankStrategies(results: StrategyReplayResult[]): StrategyReplayResult[] {
  return [...results].sort((a, b) => b.totalPnlSol - a.totalPnlSol);
}
