import type { TradeEvent } from "../types.js";

// Bundle / sniper-cluster heuristic over the earliest trades. A "bundle" launch
// shows many distinct buyers in the same instant buying near-identical sizes —
// the signature of a coordinated/insider snipe. Pure + deterministic.

export interface BundleSignals {
  /** 0..100, higher = more bundle-like. */
  bundleScore: number;
  /** Number of same-instant similar-size buy clusters found. */
  clusters: number;
  /** Fraction of buyers that bought exactly once (single-shot snipers proxy). */
  oneAndDoneRatio?: number;
  /** Obvious bundle at the very launch instant (feeds Stage-0 bundleDetected). */
  detected: boolean;
}

export interface BundleOptions {
  bucketMs?: number;
  minClusterBuyers?: number;
  sizeTolerance?: number; // fractional spread allowed within a cluster
}

export function analyzeBundle(trades: TradeEvent[], opts: BundleOptions = {}): BundleSignals {
  const bucketMs = opts.bucketMs ?? 1500;
  const minClusterBuyers = opts.minClusterBuyers ?? 4;
  const sizeTol = opts.sizeTolerance ?? 0.1;

  const buys = trades.filter((t) => t.side === "buy").sort((a, b) => a.at - b.at);
  if (buys.length === 0) return { bundleScore: 0, clusters: 0, detected: false };

  const start = buys[0]!.at;
  const buckets = new Map<number, TradeEvent[]>();
  for (const b of buys) {
    const idx = Math.floor((b.at - start) / bucketMs);
    let arr = buckets.get(idx);
    if (!arr) {
      arr = [];
      buckets.set(idx, arr);
    }
    arr.push(b);
  }

  let clusters = 0;
  let clusteredVolume = 0;
  let totalVolume = 0;
  for (const b of buys) totalVolume += b.solAmount ?? 0;

  for (const group of buckets.values()) {
    const distinctBuyers = new Set(group.map((g) => g.trader)).size;
    if (distinctBuyers < minClusterBuyers) continue;
    const sizes = group.map((g) => g.solAmount ?? 0).filter((s) => s > 0);
    if (sizes.length < minClusterBuyers) continue;
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    const similar = min > 0 && (max - min) / min <= sizeTol;
    if (similar) {
      clusters++;
      clusteredVolume += sizes.reduce((a, b) => a + b, 0);
    }
  }

  // one-and-done ratio
  const buyCountByTrader = new Map<string, number>();
  for (const b of buys) buyCountByTrader.set(b.trader, (buyCountByTrader.get(b.trader) ?? 0) + 1);
  const oneAndDone = [...buyCountByTrader.values()].filter((n) => n === 1).length;
  const oneAndDoneRatio = buyCountByTrader.size ? oneAndDone / buyCountByTrader.size : undefined;

  const volShare = totalVolume > 0 ? clusteredVolume / totalVolume : 0;
  const bundleScore = Math.min(100, clusters * 25 + volShare * 50 + (oneAndDoneRatio ?? 0) * 25);

  // Obvious if a similar-size cluster occurred in the very first bucket.
  const launchGroup = buckets.get(0) ?? [];
  const launchSizes = launchGroup.map((g) => g.solAmount ?? 0).filter((s) => s > 0);
  const launchDistinct = new Set(launchGroup.map((g) => g.trader)).size;
  let detected = false;
  if (launchDistinct >= minClusterBuyers && launchSizes.length >= minClusterBuyers) {
    const min = Math.min(...launchSizes);
    const max = Math.max(...launchSizes);
    detected = min > 0 && (max - min) / min <= sizeTol;
  }

  return { bundleScore, clusters, oneAndDoneRatio, detected };
}
