import type { MarketSnapshot } from "../types.js";

// DexScreener free API → market snapshot (price, liquidity, volume, fdv).
// No key required. Best-effort: returns undefined on failure.

const ENDPOINT = "https://api.dexscreener.com/latest/dex/tokens/";

interface DexPair {
  priceUsd?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { m5?: number; h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number };
  txns?: { m5?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number } };
  baseToken?: { address?: string };
}

/** Max token addresses DexScreener accepts in one /tokens/ request. */
export const DEX_BATCH_MAX = 30;

function pairToSnapshot(mint: string, pair: DexPair): MarketSnapshot {
  return {
    mint,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : undefined,
    liquidityUsd: pair.liquidity?.usd,
    marketCapUsd: pair.fdv ?? pair.marketCap,
    volume: { m5: pair.volume?.m5, h1: pair.volume?.h1, h24: pair.volume?.h24 },
    txns: pair.txns,
    priceChange: { m5: pair.priceChange?.m5, h1: pair.priceChange?.h1 },
    at: Date.now(),
  };
}

/**
 * Group a multi-token /tokens/ response into one snapshot per mint. Pure +
 * exported for tests. DexScreener returns pairs interleaved across the queried
 * tokens (most-liquid first), so we keep the FIRST pair seen per mint — matching
 * the single-fetch pairs[0] semantics. `restrictTo`, if given, limits the result
 * to those mints (so an unexpected extra token in the payload is ignored).
 */
export function snapshotsFromPairs(pairs: DexPair[], restrictTo?: Set<string>): Map<string, MarketSnapshot> {
  const out = new Map<string, MarketSnapshot>();
  for (const pair of pairs) {
    const mint = pair.baseToken?.address;
    if (!mint || out.has(mint)) continue;
    if (restrictTo && !restrictTo.has(mint)) continue;
    out.set(mint, pairToSnapshot(mint, pair));
  }
  return out;
}

export async function fetchDexSnapshot(mint: string, timeoutMs = 6000): Promise<MarketSnapshot | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT + mint, { signal: ctrl.signal });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { pairs?: DexPair[] };
    const pair = json.pairs?.[0];
    if (!pair) return { mint, at: Date.now() };
    return pairToSnapshot(mint, pair);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Price MANY tokens at once (≤30 per request) → Map<mint, snapshot>. The exit
 * engine uses this to re-price every open position every tick: a per-position
 * rate-limited fetch only reached ~20 of 60+ positions per tick, so fast crashes
 * blew past the stop-loss (firing at −85% instead of −45%) before being seen.
 * Best-effort: a failed batch is skipped, not fatal.
 */
export async function fetchDexSnapshots(mints: string[], timeoutMs = 8000): Promise<Map<string, MarketSnapshot>> {
  const out = new Map<string, MarketSnapshot>();
  const unique = [...new Set(mints.filter(Boolean))];
  for (let i = 0; i < unique.length; i += DEX_BATCH_MAX) {
    const batch = unique.slice(i, i + DEX_BATCH_MAX);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT + batch.join(","), { signal: ctrl.signal });
      if (!res.ok) continue;
      const json = (await res.json()) as { pairs?: DexPair[] };
      for (const [mint, snap] of snapshotsFromPairs(json.pairs ?? [], new Set(batch))) out.set(mint, snap);
    } catch {
      /* skip this batch; the next tick retries */
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}
