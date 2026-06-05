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
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
