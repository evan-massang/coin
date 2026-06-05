import type { Decision, ExitPlan, ExitSignal, LadderRung, Position, PositionSource } from "../types.js";
import { emptyScores } from "../types.js";
import type { Services } from "../services.js";
import type { PositionsRepo } from "../store/repositories/positionsRepo.js";
import { fetchDexSnapshots } from "../sources/dexscreener.js";
import { log } from "../util/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Exit engine (§1.8). Exit > entry — meme coins die fast. Pure evaluator plus
// plan builders. Priority (highest first):
//   1. HARD EXIT (SELL_EXIT_NOW, 100%): dev sold, top holder dumping, LP risk
//      change, tracked alpha wallet exits, buyer-velocity rollover, visible
//      distribution. These BEAT the profit ladder.
//   2. TIME STOP (MAX_HOLD): exit the remainder.
//   3. TRAILING STOP (volatility-aware, once in profit): lock the runner.
//   4. PROFIT LADDER: 40% @2x, 30% @3x, 20% @5x; keep a 10% runner.
//   5. HOLD.
// ─────────────────────────────────────────────────────────────────────────────

export function buildDefaultLadder(): LadderRung[] {
  return [
    { multiple: 2, sellPct: 0.4, done: false },
    { multiple: 3, sellPct: 0.3, done: false },
    { multiple: 5, sellPct: 0.2, done: false },
    // remaining 10% is the runner, managed by the trailing stop
  ];
}

export function defaultExitPlan(maxHoldMs: number, trailingStopPct = 0.35): ExitPlan {
  return { ladder: buildDefaultLadder(), trailingStopPct, maxHoldMs };
}

export interface HardSignals {
  devWalletSold?: boolean;
  topHolderDumping?: boolean;
  lpRiskChanged?: boolean;
  alphaWalletExited?: boolean;
  buyerVelocityRollover?: boolean;
  distributionDetected?: boolean;
}

export interface ExitInputs {
  currentPriceUsd: number;
  now: number;
  /** 0..1 — widens the trailing stop in choppy conditions. */
  volatility?: number;
  hard?: HardSignals;
}

export interface ExitEvaluation {
  signal: ExitSignal;
  /** Ladder rung indices that fired (the caller marks them done + persists). */
  rungsHit: number[];
}

const HARD_LABELS: Record<keyof HardSignals, string> = {
  devWalletSold: "dev wallet sold",
  topHolderDumping: "top holder dumping",
  lpRiskChanged: "LP risk changed",
  alphaWalletExited: "tracked alpha wallet exited",
  buyerVelocityRollover: "buyer velocity rolled over",
  distributionDetected: "distribution detected",
};

export function evaluateExit(p: Position, inp: ExitInputs, cfg: { maxHoldMs: number; stopLossPct?: number }): ExitEvaluation {
  const hold = (kind: ExitSignal["kind"], sellPct: number, reason: string, hard: boolean, rungsHit: number[] = []): ExitEvaluation => ({
    signal: { mint: p.mint, kind, sellPct, reason, hard, at: inp.now },
    rungsHit,
  });

  const entry = p.entryPriceUsd;
  const cur = inp.currentPriceUsd;
  const multiple = entry > 0 ? cur / entry : 1;
  const peak = Math.max(p.peakPriceUsd, cur);
  const dropFromPeak = peak > 0 ? (peak - cur) / peak : 0;

  // 1. HARD EXIT — beats everything.
  const hard = inp.hard ?? {};
  const firedHard = (Object.keys(HARD_LABELS) as Array<keyof HardSignals>).filter((k) => hard[k]);
  if (firedHard.length > 0) {
    return hold("SELL_EXIT_NOW", 1, `Hard exit: ${firedHard.map((k) => HARD_LABELS[k]).join(", ")}`, true);
  }

  // 2. TIME STOP.
  if (cfg.maxHoldMs > 0 && inp.now - p.entryAtMs > cfg.maxHoldMs) {
    return hold("SELL_EXIT_NOW", 1, `Time stop: held > ${Math.round(cfg.maxHoldMs / 60000)}m`, false);
  }

  // 2b. STOP-LOSS — cut a loser fast (meme coins die fast); without this a -45%
  //     position bleeds to the 4h time stop. Only fires below entry, so it can
  //     never cut a winner (the trailing stop handles profitable give-back).
  if (cfg.stopLossPct && cfg.stopLossPct > 0 && multiple <= 1 - cfg.stopLossPct) {
    return hold("SELL_EXIT_NOW", 1, `Stop loss: ${Math.round((1 - multiple) * 100)}% below entry`, false);
  }

  // 3. TRAILING STOP (only meaningful once in profit).
  const effectiveStop = (p.exitPlan.trailingStopPct || 0.35) * (1 + (inp.volatility ?? 0) * 0.5);
  if (multiple >= 1.5 && dropFromPeak >= effectiveStop) {
    return hold(
      "SELL_EXIT_NOW",
      1,
      `Trailing stop: -${(dropFromPeak * 100).toFixed(0)}% from peak (${multiple.toFixed(1)}x)`,
      false,
    );
  }

  // 4. PROFIT LADDER.
  const ladder = p.exitPlan.ladder ?? [];
  const rungsHit: number[] = [];
  let initialFracToSell = 0;
  ladder.forEach((rung, i) => {
    if (!rung.done && multiple >= rung.multiple) {
      rungsHit.push(i);
      initialFracToSell += rung.sellPct;
    }
  });
  if (rungsHit.length > 0) {
    const remainingFrac = p.initialTokenAmount > 0 ? p.tokenAmount / p.initialTokenAmount : 1;
    const sellPctOfCurrent = remainingFrac > 0 ? Math.min(1, initialFracToSell / remainingFrac) : 1;
    const topMult = Math.max(...rungsHit.map((i) => ladder[i]!.multiple));
    return hold("SELL_TRIM", sellPctOfCurrent, `Profit ladder: ${topMult}x — trim ${Math.round(initialFracToSell * 100)}%`, false, rungsHit);
  }

  return hold("HOLD", 0, "hold", false);
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface ExitEngineOptions {
  source: PositionSource;
  intervalMs?: number;
  /** Optional provider of hard-exit signals per position (Phase 6 fills this). */
  hardSignalsFor?: (pos: Position) => HardSignals | undefined;
  /** Called when a non-HOLD exit fires. Paper trading executes the sale here. */
  onExit?: (pos: Position, signal: ExitSignal) => void;
}

/**
 * Periodically prices open positions, evaluates exits, persists ladder progress,
 * and dispatches SELL_TRIM / SELL_EXIT_NOW alerts. For the read-only wallet it
 * only ALERTS (the user sells manually; the observer detects the close). For
 * paper trading the onExit hook performs the simulated fill.
 */
export class ExitEngine {
  private readonly repo: PositionsRepo;
  private readonly source: PositionSource;
  private readonly intervalMs: number;
  private readonly exitedOnce = new Set<number>(); // throttle repeat EXIT_NOW alerts
  private ticking = false; // guard against overlapping ticks (batched pricing can be slow)
  private lastPruneAt = 0; // throttles profit-sample pruning (paper only)
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly svc: Services,
    private readonly opts: ExitEngineOptions,
  ) {
    this.repo = opts.source === "paper" ? svc.paperPositions : svc.positions;
    this.source = opts.source;
    this.intervalMs = opts.intervalMs ?? 15_000;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    log.ok(`exit engine started (${this.source})`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.ticking) return; // a slow batch-priced tick is still running
    this.ticking = true;
    try {
      await this.runTick();
    } finally {
      this.ticking = false;
    }
  }

  private async runTick(): Promise<void> {
    const open = this.repo.byStatus(true);
    if (open.length === 0) return;
    const maxHoldMs = this.svc.settings.get("maxHoldMinutes") * 60_000;
    const now = Date.now();

    // Keep the profit-chart sample table bounded (rolling ~6h), checked ~every 10m.
    if (this.source === "paper" && now - this.lastPruneAt > 10 * 60_000) {
      this.lastPruneAt = now;
      this.svc.paper.pruneSamples(now - 6 * 60 * 60_000);
    }

    // Price EVERY open position this tick (batched, ≤30/call) so a fast crash is
    // caught near the stop-loss threshold, not 30-60s later at −85%.
    const prices = await fetchDexSnapshots(open.map((p) => p.mint)).catch(() => new Map());

    for (const pos of open) {
      const priceUsd = prices.get(pos.mint)?.priceUsd;
      if (priceUsd === undefined) continue;

      // Track peak/last for the trailing stop.
      pos.lastPriceUsd = priceUsd;
      pos.peakPriceUsd = Math.max(pos.peakPriceUsd, priceUsd);

      // Record the profit trajectory (PnL % vs entry) for the dashboard chart —
      // paper positions only (the coins we actually "bought").
      if (this.source === "paper" && pos.entryPriceUsd > 0) {
        this.svc.paper.recordPriceSample(pos.id, now, (priceUsd / pos.entryPriceUsd - 1) * 100);
      }

      const evalResult = evaluateExit(
        pos,
        { currentPriceUsd: priceUsd, now, hard: this.opts.hardSignalsFor?.(pos) },
        { maxHoldMs, stopLossPct: this.svc.settings.get("stopLossPct") },
      );

      // Mark fired ladder rungs done so we don't re-alert the same trim.
      for (const i of evalResult.rungsHit) {
        const rung = pos.exitPlan.ladder[i];
        if (rung) rung.done = true;
      }
      this.repo.update(pos);

      const sig = evalResult.signal;
      if (sig.kind === "HOLD") continue;

      // Throttle repeated full-exit alerts (they'd otherwise fire every tick).
      const isLadder = evalResult.rungsHit.length > 0;
      if (!isLadder) {
        if (this.exitedOnce.has(pos.id)) {
          this.opts.onExit?.(pos, sig); // paper still acts every tick if it wants
          continue;
        }
        this.exitedOnce.add(pos.id);
      }

      this.svc.dispatcher.dispatch(this.sellDecision(pos, sig));
      this.opts.onExit?.(pos, sig);
    }
  }

  private sellDecision(pos: Position, sig: ExitSignal): Decision {
    const multiple = pos.entryPriceUsd > 0 && pos.lastPriceUsd ? pos.lastPriceUsd / pos.entryPriceUsd : 1;
    return {
      mint: pos.mint,
      symbol: pos.symbol,
      verdict: sig.kind === "SELL_EXIT_NOW" ? "SELL_EXIT_NOW" : "SELL_TRIM",
      conviction: sig.kind === "SELL_EXIT_NOW" ? 100 : 70,
      scores: { ...emptyScores(), momentum: Math.round(Math.min(100, multiple * 20)) },
      reasons: [sig.reason, `${multiple.toFixed(1)}x from entry`],
      flags: sig.hard ? ["hard-exit"] : [],
      caps: [],
      at: sig.at,
    };
  }
}
