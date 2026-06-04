import type { TradeEvent, WalletScore } from "../types.js";

// Copy-trading (§1.9): score a wallet from its realized round-trips, then gate
// copying with hard don't-copy rules. A tracked wallet EXIT feeds the exit
// engine's hard signal. All pure.

export interface RoundTrip {
  mint: string;
  entrySol: number;
  exitSol: number;
  multiple: number;
  holdMs: number;
  rug: boolean;
}

/** Reconstruct closed round-trips for a single wallet from its trade history. */
export function buildRoundTrips(trades: TradeEvent[], now = Date.now()): RoundTrip[] {
  const byMint = new Map<string, TradeEvent[]>();
  for (const t of trades) {
    const arr = byMint.get(t.mint);
    if (arr) arr.push(t);
    else byMint.set(t.mint, [t]);
  }

  const trips: RoundTrip[] = [];
  for (const [mint, ts] of byMint) {
    const ordered = [...ts].sort((a, b) => a.at - b.at);
    const buys = ordered.filter((t) => t.side === "buy");
    const sells = ordered.filter((t) => t.side === "sell");
    if (buys.length === 0 || sells.length === 0) continue; // still open / never entered

    const boughtTokens = sum(buys.map((b) => b.tokenAmount ?? 0));
    const soldTokens = sum(sells.map((s) => s.tokenAmount ?? 0));
    // Treat as closed if ~all tokens were sold back.
    if (boughtTokens > 0 && soldTokens < boughtTokens * 0.9) continue;

    const entrySol = sum(buys.map((b) => b.solAmount ?? 0));
    const exitSol = sum(sells.map((s) => s.solAmount ?? 0));
    if (entrySol <= 0) continue;
    const multiple = exitSol / entrySol;
    const holdMs = (sells[sells.length - 1]!.at ?? now) - (buys[0]!.at ?? now);
    trips.push({ mint, entrySol, exitSol, multiple, holdMs, rug: multiple < 0.2 });
  }
  return trips;
}

export function scoreWallet(address: string, trades: TradeEvent[], now = Date.now()): WalletScore {
  const trips = buildRoundTrips(trades, now);
  const blockReasons: string[] = [];

  if (trips.length === 0) {
    return {
      address,
      pnl30dSol: 0,
      pnl90dSol: 0,
      twoXHitRate: 0,
      avgHoldMs: 0,
      rugExposureRate: 0,
      earlyEntryScore: 0,
      exitsBeforeFollowers: false,
      score: 40, // unproven
      blockReasons: ["no closed round-trips"],
    };
  }

  const D30 = 30 * 86_400_000;
  const pnl = (t: RoundTrip) => t.exitSol - t.entrySol;
  // We don't have per-trip close timestamps here, so 90d is all closed trips and
  // 30d is a proxy over the shorter-hold (more recent) ones.
  const pnl90dSol = sum(trips.map(pnl));
  const pnl30dSol = sum(trips.filter((t) => t.holdMs <= D30).map(pnl));

  const twoX = trips.filter((t) => t.multiple >= 2).length;
  const twoXHitRate = twoX / trips.length;
  const avgHoldMs = sum(trips.map((t) => t.holdMs)) / trips.length;
  const rugExposureRate = trips.filter((t) => t.rug).length / trips.length;
  const avgMultiple = sum(trips.map((t) => t.multiple)) / trips.length;
  const earlyEntryScore = Math.min(100, Math.round(avgMultiple * 20));

  let score = 50;
  score += twoXHitRate * 30;
  score += Math.min(20, Math.max(-20, pnl90dSol)); // SOL pnl nudges score
  score -= rugExposureRate * 40;
  score += Math.min(15, (avgMultiple - 1) * 10);
  score = Math.max(0, Math.min(100, Math.round(score)));

  if (rugExposureRate > 0.3) blockReasons.push(`high rug exposure ${(rugExposureRate * 100).toFixed(0)}%`);

  return {
    address,
    pnl30dSol,
    pnl90dSol,
    twoXHitRate,
    avgHoldMs,
    rugExposureRate,
    earlyEntryScore,
    exitsBeforeFollowers: false,
    score,
    blockReasons,
  };
}

export interface CopyContext {
  tokenPassedStage0: boolean;
  /** Current price vs the wallet's entry, %. >20 means we'd be chasing. */
  currentPriceVsWalletEntryPct?: number;
  walletBuySizeSol?: number;
  sharedFundingSource?: boolean;
  minWalletScore?: number;
}

export function shouldCopy(score: WalletScore, ctx: CopyContext): { copy: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const min = ctx.minWalletScore ?? 55;

  if (score.score < min) reasons.push(`wallet score ${score.score} < ${min}`);
  if (!ctx.tokenPassedStage0) reasons.push("token failed Stage-0 safety");
  if ((ctx.currentPriceVsWalletEntryPct ?? 0) > 20) reasons.push("price >20% above wallet's entry");
  if (ctx.walletBuySizeSol !== undefined && ctx.walletBuySizeSol < 0.05) reasons.push("wallet buy size unusually small");
  if (ctx.sharedFundingSource) reasons.push("shared funding source with other 'alpha' wallets");
  if (score.rugExposureRate > 0.3) reasons.push("wallet frequently enters rugs");

  return { copy: reasons.length === 0, reasons };
}

/** A tracked wallet selling this mint → alpha exit (feeds exit hard signal). */
export function detectAlphaExit(address: string, trades: TradeEvent[], mint: string): boolean {
  return trades.some((t) => t.trader === address && t.mint === mint && t.side === "sell");
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
