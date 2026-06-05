import type { LadderRung, ScoreBreakdown } from "../types.js";
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

// ─────────────────────────────────────────────────────────────────────────────
// Faithful exit model (Cycle 5). `ladderCapture` above ignores maxDrawdownPct and
// cannot score a stop-loss, so it can't tell us whether the deployed stop-loss
// helps on history. We only have the recorded PEAK (maxGainPct) and TROUGH
// (maxDrawdownPct), NOT the path order, so a single number is dishonest — a token
// that ends at a 3.8x peak with a 74% drawdown almost certainly ran THEN gave back
// (peak-first), while a token that only fell hit its stop on the way down. We
// therefore return both ORDERING BOUNDS and let the caller see the range.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExitModel {
  ladder?: LadderRung[];
  /** Give-back from peak once the runner is in profit. */
  trailingStopPct?: number;
  /** Cut below entry at this fraction (e.g. 0.45). 0 = off. */
  stopLossPct?: number;
  /** Multiple at which the trailing stop becomes active (matches the live engine). */
  trailingActivateMultiple?: number;
}

export interface ExitBounds {
  /** Peak-first: the token ran (ladder trims), then gave back / stopped on the way down. */
  optimistic: number;
  /** Trough-first: the drawdown breached the stop BEFORE any rung, so the peak is forfeit. */
  pessimistic: number;
}

/**
 * Capture fraction (1 = break-even) given the recorded peak & trough, under both
 * event orderings. Pure. The truth for a winner is ~optimistic, for a pure loser
 * ~pessimistic; reporting both is honest about the path we don't have.
 */
export function exitOutcomeBounds(maxGainPct: number, maxDrawdownPct: number, m: ExitModel = {}): ExitBounds {
  const ladder = m.ladder ?? buildDefaultLadder();
  const trailing = m.trailingStopPct ?? 0.35;
  const stop = m.stopLossPct ?? 0;
  const activate = m.trailingActivateMultiple ?? 1.5;
  const peak = 1 + (maxGainPct || 0) / 100;
  const trough = 1 - Math.max(0, maxDrawdownPct || 0) / 100;
  const stopHit = stop > 0 && trough <= 1 - stop;

  // PEAK-FIRST: trims at every rung the peak reached; the remainder then exits via
  // the trailing stop (if it ran past `activate`), else is capped by the stop-loss
  // on the way down, else rides to ~the trough at the time stop.
  let captured = 0;
  let remaining = 1;
  for (const r of ladder) {
    if (peak >= r.multiple) {
      captured += r.sellPct * r.multiple;
      remaining -= r.sellPct;
    }
  }
  let remainderExit: number;
  if (peak >= activate) remainderExit = peak * (1 - trailing);
  else if (stopHit) remainderExit = 1 - stop;
  else remainderExit = Math.max(0, trough);
  const optimistic = captured + remaining * Math.max(0, remainderExit);

  // TROUGH-FIRST: if the stop is breached, the whole position is cut at the stop
  // and the later peak never happens. If the stop is never breached, ordering is
  // irrelevant ⇒ same as peak-first.
  const pessimistic = stopHit ? 1 - stop : optimistic;
  return { optimistic, pessimistic };
}

export interface FaithfulBacktest {
  trades: number;
  /** Mean per-trade PnL fraction under each ordering bound (0 = break-even). */
  pnlOptimistic: number;
  pnlPessimistic: number;
  /** Win rate (optimistic capture > 1). */
  winRate: number;
}

/**
 * Like runBacktest but scores exits with `exitOutcomeBounds` (drawdown- and
 * stop-loss-aware). Returns the PnL range across orderings so a stop-loss change
 * can be evaluated honestly. Selection (the gate) is unchanged.
 */
export function backtestExits(
  signals: HistSignal[],
  thresholds: DecisionThresholds,
  exit: ExitModel = {},
): FaithfulBacktest {
  let trades = 0;
  let opt = 0;
  let pess = 0;
  let wins = 0;
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
    const b = exitOutcomeBounds(s.maxGainPct ?? 0, s.maxDrawdownPct ?? 0, exit);
    opt += b.optimistic - 1;
    pess += b.pessimistic - 1;
    if (b.optimistic > 1) wins++;
  }
  return {
    trades,
    pnlOptimistic: trades ? opt / trades : 0,
    pnlPessimistic: trades ? pess / trades : 0,
    winRate: trades ? wins / trades : 0,
  };
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
