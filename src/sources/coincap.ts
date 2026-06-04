import type { MarketMacro } from "./coingecko.js";

// Keyless secondary fallback macro source (CoinCap).
export async function getMacroFromCoincap(timeoutMs = 5000): Promise<MarketMacro> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const [sol, btc] = await Promise.all([
      fetch("https://api.coincap.io/v2/assets/solana", { signal: ctrl.signal }),
      fetch("https://api.coincap.io/v2/assets/bitcoin", { signal: ctrl.signal }),
    ]);
    if (!sol.ok || !btc.ok) return {};
    const sj = (await sol.json()) as { data?: { changePercent24Hr?: string } };
    const bj = (await btc.json()) as { data?: { changePercent24Hr?: string } };
    const num = (v?: string) => (v != null && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return { solChange24h: num(sj.data?.changePercent24Hr), btcChange24h: num(bj.data?.changePercent24Hr) };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
