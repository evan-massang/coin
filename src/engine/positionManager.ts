import type { PositionsRepo } from "../store/repositories/positionsRepo.js";
import type { ExitPlan, Position, PositionSource } from "../types.js";
import type { WalletActivity } from "../wallet/positionDetector.js";
import { applyBuy, applySell, type PnlState } from "../wallet/pnlCalculator.js";

// Bridges detected buy/sell activity (or paper fills) to persisted positions,
// keeping cost basis + realized PnL via the SOL-native PnL math. Works for both
// the read-only wallet observer (source='wallet') and paper trading.

export type MarkResult = "entered" | "added" | "reduced" | "closed" | "ignored";

export interface ApplyContext {
  symbol?: string;
  solUsd: number;
  /** Fallback price (SOL/token) when the activity itself had no derivable price. */
  fallbackPriceSol?: number;
  now?: number;
}

function defaultExitPlan(): ExitPlan {
  // The exit engine (Phase 5) installs the real ladder/stops; this is a holder.
  return { ladder: [], trailingStopPct: 0.35, maxHoldMs: 0 };
}

function stateOf(p: Position): PnlState {
  return {
    tokenAmount: p.tokenAmount,
    costBasisSol: p.solInvested,
    avgEntryPriceSol: p.tokenAmount > 0 ? p.solInvested / p.tokenAmount : 0,
    realizedPnlSol: 0, // accumulated on the Position in USD, per-sale
  };
}

export class PositionManager {
  constructor(
    private readonly repo: PositionsRepo,
    private readonly source: PositionSource,
  ) {}

  applyActivity(act: WalletActivity, ctx: ApplyContext): { position?: Position; marked: MarkResult } {
    const now = ctx.now ?? Date.now();
    const priceSol = act.priceSol > 0 ? act.priceSol : ctx.fallbackPriceSol ?? 0;
    const existing = this.repo.openByMint(act.mint);

    if (act.side === "buy") {
      const solSpent = act.solAmount > 0 ? act.solAmount : priceSol * act.tokenAmount;
      if (!existing) {
        const entryPriceUsd = priceSol * ctx.solUsd;
        const id = this.repo.open({
          mint: act.mint,
          symbol: ctx.symbol,
          source: this.source,
          status: "OPEN",
          entryPriceUsd,
          entryAtMs: now,
          tokenAmount: act.tokenAmount,
          initialTokenAmount: act.tokenAmount,
          solInvested: solSpent,
          costBasisUsd: solSpent * ctx.solUsd,
          realizedPnlUsd: 0,
          peakPriceUsd: entryPriceUsd,
          lastPriceUsd: entryPriceUsd,
          exitPlan: defaultExitPlan(),
        });
        return { position: this.repo.get(id), marked: "entered" };
      }
      const next = applyBuy(stateOf(existing), act.tokenAmount, solSpent);
      existing.tokenAmount = next.tokenAmount;
      existing.solInvested = next.costBasisSol;
      existing.costBasisUsd = next.costBasisSol * ctx.solUsd;
      existing.status = "OPEN";
      this.repo.update(existing);
      return { position: existing, marked: "added" };
    }

    // Sell.
    if (!existing) return { marked: "ignored" }; // selling something we never tracked
    const solReceived = act.solAmount > 0 ? act.solAmount : priceSol * act.tokenAmount;
    const { state, realizedDeltaSol } = applySell(stateOf(existing), act.tokenAmount, solReceived);
    existing.tokenAmount = state.tokenAmount;
    existing.solInvested = state.costBasisSol;
    existing.realizedPnlUsd += realizedDeltaSol * ctx.solUsd;
    if (priceSol > 0) {
      existing.lastPriceUsd = priceSol * ctx.solUsd;
      existing.peakPriceUsd = Math.max(existing.peakPriceUsd, existing.lastPriceUsd);
    }
    if (state.tokenAmount <= 1e-9) {
      existing.status = "CLOSED";
      existing.closedAtMs = now;
      this.repo.update(existing);
      return { position: existing, marked: "closed" };
    }
    existing.status = "PARTIAL";
    this.repo.update(existing);
    return { position: existing, marked: "reduced" };
  }

  /** Mark-to-market the current price (drives unrealized PnL + the exit engine). */
  markPrice(mint: string, priceSol: number, solUsd: number, now = Date.now()): Position | undefined {
    const pos = this.repo.openByMint(mint);
    if (!pos || priceSol <= 0) return pos;
    pos.lastPriceUsd = priceSol * solUsd;
    pos.peakPriceUsd = Math.max(pos.peakPriceUsd, pos.lastPriceUsd);
    this.repo.update(pos);
    void now;
    return pos;
  }
}
