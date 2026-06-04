import type { MarketMacro } from "./coingecko.js";

// Keyless fallback macro source (CoinPaprika) when CoinGecko's circuit is open.
export async function getMacroFromPaprika(timeoutMs = 5000): Promise<MarketMacro> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const [sol, btc] = await Promise.all([
      fetch("https://api.coinpaprika.com/v1/tickers/sol-solana", { signal: ctrl.signal }),
      fetch("https://api.coinpaprika.com/v1/tickers/btc-bitcoin", { signal: ctrl.signal }),
    ]);
    if (!sol.ok || !btc.ok) return {};
    const sj = (await sol.json()) as { quotes?: { USD?: { percent_change_24h?: number } } };
    const bj = (await btc.json()) as { quotes?: { USD?: { percent_change_24h?: number } } };
    return {
      solChange24h: sj.quotes?.USD?.percent_change_24h,
      btcChange24h: bj.quotes?.USD?.percent_change_24h,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
