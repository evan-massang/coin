// Cycle 3 — watch-slot recycling policy (pure, testable). The scanner can only
// hold maxWatched live trade-stream subscriptions (the free feed drops streams
// when over-subscribed). When full, recycle the DEADEST eligible slot toward a
// fresh survivor so active tokens actually accumulate enough trades to be judged.

export interface WatchSlot {
  mint: string;
  /** ms since the token was first seen. */
  age: number;
  /** observed trade count. */
  trades: number;
  /** timestamp of the most recent trade (or firstSeenAt if none). */
  lastTradeAt: number;
}

/**
 * Choose a slot to evict, or undefined to evict nothing. A slot is ELIGIBLE only
 * if it is past `minTenureMs` (no thrashing a just-admitted token) AND still below
 * `sufficientTrades` (an active token is never evicted). Among eligible slots,
 * the deadest wins: fewest trades, then oldest last-trade.
 */
export function pickWatchVictim(slots: WatchSlot[], minTenureMs: number, sufficientTrades: number): string | undefined {
  let victim: string | undefined;
  let vTrades = sufficientTrades; // only consider slots strictly below this
  let vLast = Infinity;
  for (const s of slots) {
    if (s.age < minTenureMs) continue;
    if (s.trades >= sufficientTrades) continue;
    if (s.trades < vTrades || (s.trades === vTrades && s.lastTradeAt < vLast)) {
      victim = s.mint;
      vTrades = s.trades;
      vLast = s.lastTradeAt;
    }
  }
  return victim;
}
