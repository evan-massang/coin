import { getMarketMacro, type MarketMacro } from "../sources/coingecko.js";
import { getMacroFromPaprika } from "../sources/coinpaprika.js";
import { getMacroFromCoincap } from "../sources/coincap.js";

// §Phase 4 market weather. Combines macro (SOL/BTC 24h) with INTERNAL paper
// stats (the engine's own recent win rate) — internal is weighted higher once
// there's enough data, because "is THIS engine working right now" beats the
// broad market. RISK_OFF shrinks every position via the MicroFish multiplier.

export type Weather = "RISK_ON" | "NEUTRAL" | "RISK_OFF";

export interface MarketWeatherInputs {
  solChange24h?: number;
  btcChange24h?: number;
  internalWinRate?: number;
  internalSamples?: number;
  riskOffMultiplier: number;
}

export interface MarketWeatherResult {
  weather: Weather;
  multiplier: number;
  reasons: string[];
}

export function computeMarketWeather(i: MarketWeatherInputs): MarketWeatherResult {
  const reasons: string[] = [];
  let bull = 0;
  let bear = 0;

  const macro = [i.solChange24h, i.btcChange24h].filter((x): x is number => typeof x === "number");
  if (macro.length) {
    const avg = macro.reduce((a, b) => a + b, 0) / macro.length;
    if (avg >= 3) {
      bull += 1;
      reasons.push(`macro +${avg.toFixed(1)}% 24h`);
    } else if (avg <= -3) {
      bear += 1;
      reasons.push(`macro ${avg.toFixed(1)}% 24h`);
    }
  }

  // Internal stats weighted higher (×2) once there's a meaningful sample.
  if ((i.internalSamples ?? 0) >= 10 && i.internalWinRate !== undefined) {
    if (i.internalWinRate >= 0.5) {
      bull += 2;
      reasons.push(`engine win rate ${(i.internalWinRate * 100).toFixed(0)}%`);
    } else if (i.internalWinRate <= 0.3) {
      bear += 2;
      reasons.push(`engine win rate low ${(i.internalWinRate * 100).toFixed(0)}%`);
    }
  }

  const net = bull - bear;
  const weather: Weather = net > 0 ? "RISK_ON" : net < 0 ? "RISK_OFF" : "NEUTRAL";
  const multiplier = weather === "RISK_ON" ? 1.2 : weather === "RISK_OFF" ? i.riskOffMultiplier : 1.0;
  if (!reasons.length) reasons.push("neutral market");
  return { weather, multiplier, reasons };
}

let cache: { at: number; result: MarketWeatherResult } | undefined;

/** Cached (~60s) market weather: macro via CoinGecko→Paprika→CoinCap fallback. */
export async function fetchMarketWeather(
  getInternal: () => { winRate: number; samples: number },
  riskOffMultiplier: number,
  now = Date.now(),
): Promise<MarketWeatherResult> {
  if (cache && now - cache.at < 60_000) return cache.result;

  let macro: MarketMacro = await getMarketMacro(now);
  if (macro.solChange24h === undefined) macro = await getMacroFromPaprika();
  if (macro.solChange24h === undefined) macro = await getMacroFromCoincap();

  const internal = getInternal();
  const result = computeMarketWeather({
    solChange24h: macro.solChange24h,
    btcChange24h: macro.btcChange24h,
    internalWinRate: internal.winRate,
    internalSamples: internal.samples,
    riskOffMultiplier,
  });
  cache = { at: now, result };
  return result;
}
