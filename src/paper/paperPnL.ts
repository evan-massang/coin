import type { Position } from "../types.js";
import type { PaperWalletState } from "../store/repositories/paperRepo.js";

// Paper PnL aggregation (§1.11). Realized comes from recorded fills (SOL);
// unrealized is marked from each open position's last price vs its cost basis.

export interface PaperStats {
  balanceSol: number;
  startingBalanceSol: number;
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

export function computePaperStats(
  wallet: PaperWalletState | undefined,
  open: Position[],
  closed: Position[],
  realizedPnlSol: number,
): PaperStats {
  let unrealizedPnlSol = 0;
  for (const p of open) {
    if (p.lastPriceUsd && p.entryPriceUsd > 0) {
      unrealizedPnlSol += (p.lastPriceUsd / p.entryPriceUsd - 1) * p.solInvested;
    }
  }

  const wins = closed.filter((p) => p.realizedPnlUsd > 0).length;
  const holdMs = closed.filter((p) => p.closedAtMs).map((p) => (p.closedAtMs ?? 0) - p.entryAtMs);
  const tradePcts = closed
    .filter((p) => p.entryPriceUsd > 0 && p.lastPriceUsd)
    .map((p) => (p.lastPriceUsd! / p.entryPriceUsd - 1) * 100);

  return {
    balanceSol: wallet?.balanceSol ?? 0,
    startingBalanceSol: wallet?.startingBalanceSol ?? 0,
    realizedPnlSol,
    unrealizedPnlSol,
    totalPnlSol: realizedPnlSol + unrealizedPnlSol,
    openCount: open.length,
    closedCount: closed.length,
    winRate: closed.length ? wins / closed.length : 0,
    bestTradePct: tradePcts.length ? Math.max(...tradePcts) : 0,
    worstTradePct: tradePcts.length ? Math.min(...tradePcts) : 0,
    avgHoldMs: holdMs.length ? holdMs.reduce((a, b) => a + b, 0) / holdMs.length : 0,
  };
}
