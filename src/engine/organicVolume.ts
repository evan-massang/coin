import type { TradeEvent } from "../types.js";

// §1.3 Anti-wash / Organic Volume score. 60–80% of meme-coin volume is bots;
// this scores how *real* the buying looks (0..100, higher = more organic). It
// is a pure function of the observed trade stream so it's fully testable.
//
// Signals: unique-buyer ratio, repeated/identical sizes, round-number buys,
// trade-size entropy, one-and-done (single-shot) wallets, and too-regular
// buy/sell alternation. We start at 100 and subtract transparent penalties.

export interface OrganicResult {
  score: number;
  reasons: string[];
  flags: string[];
  uniqueBuyerRatio?: number;
  freshWalletRatio?: number; // proxy: one-and-done buyer ratio
}

const ROUND_SIZES = [0.1, 0.25, 0.5, 1, 2, 5, 10];

export function computeOrganicScore(trades: TradeEvent[]): OrganicResult {
  const buys = trades.filter((t) => t.side === "buy");
  const reasons: string[] = [];
  const flags: string[] = [];

  if (buys.length < 5) {
    // Not enough data to judge — neutral-low so it can't BUY on thin evidence.
    return { score: 45, reasons: ["insufficient trade data"], flags: [] };
  }

  let score = 100;

  // 1. Unique-buyer ratio.
  const buyers = buys.map((b) => b.trader);
  const uniqueBuyers = new Set(buyers).size;
  const uniqueBuyerRatio = uniqueBuyers / buys.length;
  if (uniqueBuyerRatio < 0.4) {
    score -= 30;
    flags.push("few-unique-buyers");
    reasons.push(`only ${(uniqueBuyerRatio * 100).toFixed(0)}% unique buyers`);
  } else if (uniqueBuyerRatio < 0.6) {
    score -= 14;
    reasons.push(`low unique-buyer ratio ${(uniqueBuyerRatio * 100).toFixed(0)}%`);
  }

  // 2. One-and-done wallets (single-shot snipers/bots).
  const buyCount = new Map<string, number>();
  for (const b of buyers) buyCount.set(b, (buyCount.get(b) ?? 0) + 1);
  const oneAndDone = [...buyCount.values()].filter((n) => n === 1).length;
  const freshWalletRatio = oneAndDone / buyCount.size;

  // 3. Repeated / identical buy sizes.
  const sizes = buys.map((b) => b.solAmount ?? 0).filter((s) => s > 0);
  const repeatedRatio = repeatedSizeRatio(sizes);
  if (repeatedRatio > 0.5) {
    score -= 22;
    flags.push("identical-sizes");
    reasons.push(`${(repeatedRatio * 100).toFixed(0)}% repeated buy sizes`);
  } else if (repeatedRatio > 0.3) {
    score -= 10;
  }

  // 4. Round-number buys.
  const roundRatio = sizes.length ? sizes.filter((s) => isRound(s)).length / sizes.length : 0;
  if (roundRatio > 0.6) {
    score -= 12;
    reasons.push("mostly round-number buys");
  }

  // 5. Trade-size entropy (low entropy = mechanical).
  const entropy = sizeEntropy(sizes);
  if (entropy < 0.45) {
    score -= 14;
    flags.push("low-size-entropy");
    reasons.push("low trade-size entropy (mechanical)");
  } else if (entropy < 0.65) {
    score -= 6;
  }

  // 6. Too-regular buy/sell alternation (wash trading round-trips).
  if (alternationRegularity(trades) > 0.8) {
    score -= 18;
    flags.push("wash-alternation");
    reasons.push("regular buy/sell alternation (wash)");
  }

  if (uniqueBuyerRatio >= 0.7 && entropy >= 0.7 && repeatedRatio < 0.2) {
    reasons.push("buying looks organic");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    flags,
    uniqueBuyerRatio,
    freshWalletRatio,
  };
}

function isRound(x: number): boolean {
  return ROUND_SIZES.some((r) => Math.abs(x - r) / r < 0.02);
}

function repeatedSizeRatio(sizes: number[]): number {
  if (sizes.length < 2) return 0;
  // Bucket to 3 significant figures; count sizes sharing a bucket with ≥1 other.
  const buckets = new Map<string, number>();
  for (const s of sizes) {
    const key = s.toPrecision(3);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let repeated = 0;
  for (const n of buckets.values()) if (n >= 2) repeated += n;
  return repeated / sizes.length;
}

function sizeEntropy(sizes: number[]): number {
  if (sizes.length < 2) return 1;
  // Log-scale histogram, Shannon entropy normalized to [0,1].
  const bins = new Map<number, number>();
  for (const s of sizes) {
    const bin = Math.round(Math.log10(Math.max(s, 1e-9)) * 2); // half-decade bins
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const n = sizes.length;
  let h = 0;
  for (const c of bins.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  const maxH = Math.log2(bins.size || 1);
  return maxH > 0 ? h / maxH : 0;
}

function alternationRegularity(trades: TradeEvent[]): number {
  // Fraction of consecutive trades that flip side. ~1.0 = perfect buy/sell/buy…
  if (trades.length < 4) return 0;
  const ordered = [...trades].sort((a, b) => a.at - b.at);
  let flips = 0;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.side !== ordered[i - 1]!.side) flips++;
  }
  return flips / (ordered.length - 1);
}
