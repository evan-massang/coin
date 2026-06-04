import type { TradeEvent } from "../types.js";

// §1.6 module 4 — momentum. Buyer velocity (toward the ~500-holders/hr ≈ 8/min
// virality tell), buy/sell ratio, net SOL inflow, and volume acceleration.
// Pure function of the trade stream + the current time.

export interface MomentumResult {
  score: number;
  buyerVelocityPerMin: number;
  buySellRatio: number;
  netSolInflow: number;
  volumeAcceleration: number;
  /** Buyer-velocity trend, -1 (decelerating) .. +1 (accelerating). */
  buyerVelocityTrend: number;
  reasons: string[];
}

export function computeMomentum(trades: TradeEvent[], now = Date.now()): MomentumResult {
  const reasons: string[] = [];
  if (trades.length === 0) {
    return {
      score: 0,
      buyerVelocityPerMin: 0,
      buySellRatio: 0,
      netSolInflow: 0,
      volumeAcceleration: 0,
      buyerVelocityTrend: 0,
      reasons: ["no trades"],
    };
  }

  const ordered = [...trades].sort((a, b) => a.at - b.at);
  const start = ordered[0]!.at;
  const spanMin = Math.max((now - start) / 60_000, 0.1);

  const buys = ordered.filter((t) => t.side === "buy");
  const sells = ordered.filter((t) => t.side === "sell");
  const uniqueBuyers = new Set(buys.map((b) => b.trader)).size;
  const buyerVelocityPerMin = uniqueBuyers / spanMin;
  const buySellRatio = ordered.length ? buys.length / ordered.length : 0;
  const buySol = sum(buys.map((b) => b.solAmount ?? 0));
  const sellSol = sum(sells.map((s) => s.solAmount ?? 0));
  const netSolInflow = buySol - sellSol;

  // Split the window in half for acceleration + buyer-velocity trend. Use BUY
  // volume only — a surge of sells is a dump, not momentum.
  const mid = start + (now - start) / 2;
  const firstHalf = ordered.filter((t) => t.at < mid);
  const secondHalf = ordered.filter((t) => t.at >= mid);
  const buyVol1 = sum(firstHalf.filter((t) => t.side === "buy").map((t) => t.solAmount ?? 0));
  const buyVol2 = sum(secondHalf.filter((t) => t.side === "buy").map((t) => t.solAmount ?? 0));
  const volumeAcceleration = buyVol1 > 0 ? buyVol2 / buyVol1 : buyVol2 > 0 ? 2 : 0;
  const b1 = new Set(firstHalf.filter((t) => t.side === "buy").map((t) => t.trader)).size;
  const b2 = new Set(secondHalf.filter((t) => t.side === "buy").map((t) => t.trader)).size;
  const buyerVelocityTrend = b1 + b2 > 0 ? (b2 - b1) / (b2 + b1) : 0;

  // Transparent additive score.
  let score = 0;
  if (buyerVelocityPerMin >= 8) {
    score += 35;
    reasons.push(`buyer velocity ${buyerVelocityPerMin.toFixed(1)}/min (viral pace)`);
  } else if (buyerVelocityPerMin >= 4) score += 25;
  else if (buyerVelocityPerMin >= 2) score += 15;
  else if (buyerVelocityPerMin >= 1) score += 8;

  if (buySellRatio >= 0.7) {
    score += 25;
    reasons.push(`buy pressure ${(buySellRatio * 100).toFixed(0)}%`);
  } else if (buySellRatio >= 0.6) score += 18;
  else if (buySellRatio >= 0.5) score += 10;
  else reasons.push("sell pressure dominating");

  if (netSolInflow > 0) {
    score += Math.min(20, netSolInflow * 2);
  }

  if (volumeAcceleration >= 1.5) {
    score += 20;
    reasons.push("volume accelerating");
  } else if (volumeAcceleration >= 1) score += 12;
  else if (volumeAcceleration < 0.7) reasons.push("volume fading");

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    buyerVelocityPerMin,
    buySellRatio,
    netSolInflow,
    volumeAcceleration,
    buyerVelocityTrend,
    reasons,
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
