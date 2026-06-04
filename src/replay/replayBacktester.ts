import type { Services } from "../services.js";
import { replayStrategies, rankStrategies, type StrategyReplayResult } from "./replayEngine.js";

// Orchestrates a replay over recorded events and persists the best strategy's
// result to the existing backtest_runs table (extends the learning store).
export function runReplay(
  svc: Services,
  fromMs = 0,
  toMs = Number.MAX_SAFE_INTEGER,
  now = Date.now(),
): { events: number; ranked: StrategyReplayResult[] } {
  const events = svc.events.list(fromMs, toMs);
  const ranked = rankStrategies(replayStrategies(events));
  const best = ranked[0];
  if (best) {
    svc.learning.addBacktest({
      at: now,
      settings: { strategyRank: 0 },
      trades: best.trades,
      winRate: best.winRate,
      totalPnlSol: best.totalPnlSol,
      maxDrawdownPct: best.maxDrawdownPct,
      bestTradePct: best.bestTradePct,
      worstTradePct: best.worstTradePct,
      avgHoldMs: best.avgHoldMs,
    });
  }
  return { events: events.length, ranked };
}
