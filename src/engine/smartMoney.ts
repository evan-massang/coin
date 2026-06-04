import type { TradeEvent } from "../types.js";

// Smart-money detection (§1.6 module 7). Are wallets we rate as "smart" (from
// the copy-tracking set) buying this token? With no smart wallets configured we
// return a neutral 50 (unknown) so it doesn't drag conviction. Pure.

export interface SmartMoneyResult {
  score: number;
  reasons: string[];
  smartBuyers: string[];
}

/**
 * @param smartWallets map of wallet address → its wallet score (0..100).
 */
export function computeSmartMoney(trades: TradeEvent[], smartWallets: Map<string, number>): SmartMoneyResult {
  if (smartWallets.size === 0) {
    return { score: 50, reasons: ["no smart wallets configured"], smartBuyers: [] };
  }

  const buyers = new Set(trades.filter((t) => t.side === "buy").map((t) => t.trader));
  const smartBuyers = [...buyers].filter((b) => smartWallets.has(b));

  if (smartBuyers.length === 0) {
    return { score: 45, reasons: ["no tracked smart money in this token"], smartBuyers: [] };
  }

  const avgQuality = smartBuyers.reduce((a, b) => a + (smartWallets.get(b) ?? 50), 0) / smartBuyers.length;
  // Base 55, plus a bonus scaled by how many smart wallets and how good they are.
  const score = Math.min(100, Math.round(55 + Math.min(smartBuyers.length, 4) * 6 + (avgQuality - 50) * 0.4));
  return {
    score,
    reasons: [`${smartBuyers.length} tracked smart wallet(s) bought`],
    smartBuyers,
  };
}
