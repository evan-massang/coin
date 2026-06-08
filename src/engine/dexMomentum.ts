import type { MarketSnapshot } from "../types.js";

// Cycle 4 fix — FREE trade-flow signal from DexScreener aggregates. PumpPortal's
// per-trade stream is a PAID feature (0.01 SOL / 10k events) the engine doesn't
// pay for, so the live trade buffer is empty and organic/momentum are blind.
// DexScreener's rolling 5-minute buy/sell counts + price change give an organic
// (buy-pressure) and momentum (txn/price velocity) proxy for free — and because
// the window is DexScreener's own rolling 5m, observing longer does NOT deflate
// it (unlike the now−start trade-stream momentum).

export interface DexSignals {
  /** 0..100 buy-pressure proxy. */
  organic: number;
  /** 0..100 trade/price velocity proxy. */
  momentum: number;
  /** True only when DexScreener has a real trading pair with enough recent txns. */
  confident: boolean;
  txns5m: number;
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

export function dexSignals(snap: MarketSnapshot | undefined, minTxns = 8): DexSignals {
  const t5 = snap?.txns?.m5;
  const buys = t5?.buys ?? 0;
  const sells = t5?.sells ?? 0;
  const total = buys + sells;
  const vol5 = snap?.volume?.m5 ?? 0;
  const liq = snap?.liquidityUsd ?? 0;
  const pc5 = snap?.priceChange?.m5 ?? 0;

  // Confident with enough recent txns to judge. NOTE: pump.fun bonding-curve
  // tokens report liquidity=$0 on DexScreener (liquidity lives in the curve, not
  // a pool), so confidence is gated on TXN ACTIVITY, not liquidity.
  const confident = total >= minTxns;
  void liq;

  // organic = buy share of recent txns (50/50 ⇒ 50; one-sided dump ⇒ low).
  const organic = total > 0 ? Math.round(clamp((buys / total) * 120 - 10)) : 0;

  // momentum = recent txn velocity + ENTRY-TIMING shape + volume.
  let momentum = Math.min(45, total * 1.5); // ~30 txns/5m ⇒ 45 ("is it alive")
  // Cycle-8 PIVOT: the old code REWARDED a high 5m run-up (+30 for pc5≥20) — i.e. it
  // chased spikes. Verified on 2,835 resolved signals: realized PnL is −1.6% entering
  // a dip (m5∈[-25,-3]) / −2.2% flat, but −16% chasing (m5 25–75%). So reward the
  // early/flat/dip sweet-spot and PENALISE chasing a pumped coin or catching a knife.
  momentum += pc5 <= -40 ? -22 : pc5 <= -3 ? 14 : pc5 <= 12 ? 20 : pc5 <= 30 ? 6 : pc5 <= 75 ? -14 : -24;
  momentum += vol5 >= 5000 ? 15 : vol5 >= 1000 ? 8 : 0;

  return { organic, momentum: Math.round(clamp(momentum)), confident, txns5m: total };
}
