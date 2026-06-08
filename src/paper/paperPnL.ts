import type { Position } from "../types.js";
import type { PaperWalletState } from "../store/repositories/paperRepo.js";

// Paper PnL aggregation (§1.11). Realized comes from recorded fills (SOL);
// unrealized is marked from each open position's last price vs its cost basis.

export interface PaperStats {
  balanceSol: number; // CASH (free SOL, not locked in positions)
  startingBalanceSol: number;
  openValueSol: number; // mark-to-market value of open positions
  equitySol: number; // cash + openValue — the true account worth
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  totalPnlSol: number;
  openCount: number;
  closedCount: number;
  winRate: number;
  bestTradePct: number;
  worstTradePct: number;
  avgHoldMs: number;
}

/**
 * GROUND-TRUTH accounting (Cycle 8 fix). The numbers are derived from the wallet's
 * real cash balance + live position value, NOT the separately-recorded
 * paper_trades.realized_pnl_sol ledger (which drifted out of sync with cash by a
 * partial-sell cost-basis bug, so balance and PnL never reconciled on the dashboard).
 * By construction here: equity = cash + openValue; total = equity − start;
 * realized = total − unrealized — all three always reconcile to the real account.
 * `realizedPnlSol` param is kept for signature compat but no longer trusted for totals.
 */
export function computePaperStats(
  wallet: PaperWalletState | undefined,
  open: Position[],
  closed: Position[],
  _realizedLedgerSol: number,
): PaperStats {
  const startingBalanceSol = wallet?.startingBalanceSol ?? 0;
  const balanceSol = wallet?.balanceSol ?? 0;

  let openCostSol = 0;
  let openValueSol = 0;
  for (const p of open) {
    openCostSol += p.solInvested; // already reduced on partial sells (remaining cost basis)
    const mult = p.lastPriceUsd && p.entryPriceUsd > 0 ? p.lastPriceUsd / p.entryPriceUsd : 1;
    openValueSol += p.solInvested * mult; // current market value of the remaining tokens
  }

  const equitySol = balanceSol + openValueSol;
  const totalPnlSol = equitySol - startingBalanceSol;
  const unrealizedPnlSol = openValueSol - openCostSol;
  const realizedPnlSol = totalPnlSol - unrealizedPnlSol; // = (cash + openCost) − start; ties to real cash

  const wins = closed.filter((p) => p.realizedPnlUsd > 0).length;
  const holdMs = closed.filter((p) => p.closedAtMs).map((p) => (p.closedAtMs ?? 0) - p.entryAtMs);
  const tradePcts = closed
    .filter((p) => p.entryPriceUsd > 0 && p.lastPriceUsd)
    .map((p) => (p.lastPriceUsd! / p.entryPriceUsd - 1) * 100);

  return {
    balanceSol,
    startingBalanceSol,
    openValueSol,
    equitySol,
    realizedPnlSol,
    unrealizedPnlSol,
    totalPnlSol,
    openCount: open.length,
    closedCount: closed.length,
    winRate: closed.length ? wins / closed.length : 0,
    bestTradePct: tradePcts.length ? Math.max(...tradePcts) : 0,
    worstTradePct: tradePcts.length ? Math.min(...tradePcts) : 0,
    avgHoldMs: holdMs.length ? holdMs.reduce((a, b) => a + b, 0) / holdMs.length : 0,
  };
}
