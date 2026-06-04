// SOL/USD price oracle (free CoinGecko endpoint), cached ~2 min. Used only to
// present SOL-denominated PnL in USD on the dashboard. Falls back to the last
// known value (or a sane constant) on failure — never throws.

import { CircuitBreaker } from "../util/circuitBreaker.js";

let cache: { at: number; usd: number } | undefined;
const TTL_MS = 120_000;
const FALLBACK = 150;
const breaker = new CircuitBreaker();

export interface MarketMacro {
  solChange24h?: number;
  btcChange24h?: number;
}

let macroCache: { at: number; data: MarketMacro } | undefined;

/** SOL + BTC 24h % change (CoinGecko), cached ~60s. {} on failure. */
export async function getMarketMacro(now = Date.now()): Promise<MarketMacro> {
  if (macroCache && now - macroCache.at < 60_000) return macroCache.data;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const data = await breaker.run(async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana,bitcoin&vs_currencies=usd&include_24hr_change=true",
        { signal: ctrl.signal },
      );
      if (!res.ok) throw new Error(`coingecko ${res.status}`);
      const json = (await res.json()) as {
        solana?: { usd_24h_change?: number };
        bitcoin?: { usd_24h_change?: number };
      };
      return { solChange24h: json.solana?.usd_24h_change, btcChange24h: json.bitcoin?.usd_24h_change };
    });
    macroCache = { at: now, data };
    return data;
  } catch {
    return macroCache?.data ?? {};
  } finally {
    clearTimeout(timer);
  }
}

export async function getSolUsd(now = Date.now()): Promise<number> {
  if (cache && now - cache.at < TTL_MS) return cache.usd;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      signal: ctrl.signal,
    });
    if (res.ok) {
      const json = (await res.json()) as { solana?: { usd?: number } };
      const usd = json.solana?.usd;
      if (typeof usd === "number" && usd > 0) {
        cache = { at: now, usd };
        return usd;
      }
    }
  } catch {
    /* fall through */
  } finally {
    clearTimeout(timer);
  }
  return cache?.usd ?? FALLBACK;
}
