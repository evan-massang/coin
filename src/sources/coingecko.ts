// SOL/USD price oracle (free CoinGecko endpoint), cached ~2 min. Used only to
// present SOL-denominated PnL in USD on the dashboard. Falls back to the last
// known value (or a sane constant) on failure — never throws.

let cache: { at: number; usd: number } | undefined;
const TTL_MS = 120_000;
const FALLBACK = 150;

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
