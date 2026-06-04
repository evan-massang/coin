import type { MarketRegime } from "../types.js";

// Classifies the broad market regime — meme coins are heavily regime-driven, so
// this gates how aggressive the whole engine should be. Pure.

export interface RegimeInputs {
  weather: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
  solChange24h?: number;
  btcChange24h?: number;
  /** fraction of recent signals that were BUY (0..1). */
  buyRate?: number;
  /** fraction of recent signals that were AVOID (0..1). */
  avoidRate?: number;
}

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;
  reasons: string[];
}

export function classifyRegime(i: RegimeInputs): RegimeResult {
  const macro = [i.solChange24h, i.btcChange24h].filter((x): x is number => typeof x === "number");
  const avg = macro.length ? macro.reduce((a, b) => a + b, 0) / macro.length : 0;
  const buy = i.buyRate ?? 0;
  const avoid = i.avoidRate ?? 0;
  const reasons: string[] = [];

  let regime: MarketRegime = "NEUTRAL";
  let confidence = 50;

  if (i.weather === "RISK_OFF" && avg <= -5) {
    regime = "PANIC";
    confidence = Math.min(95, 60 + Math.abs(avg) * 3);
    reasons.push(`macro ${avg.toFixed(1)}% 24h + risk-off`);
  } else if (i.weather === "RISK_ON" && avg >= 2 && buy >= 0.1) {
    regime = "BULL_EXPANSION";
    confidence = Math.min(92, 55 + avg * 4 + buy * 40);
    reasons.push(`macro +${avg.toFixed(1)}% + buy flow ${(buy * 100).toFixed(0)}%`);
  } else if (i.weather === "RISK_OFF" || avg < -1 || avoid > 0.92) {
    regime = "DISTRIBUTION";
    confidence = Math.min(85, 55 + Math.abs(Math.min(avg, 0)) * 4 + avoid * 20);
    reasons.push(avg < 0 ? `macro ${avg.toFixed(1)}%` : "high avoid rate / risk-off");
  } else if (i.weather === "NEUTRAL" && Math.abs(avg) < 2) {
    regime = "ACCUMULATION";
    confidence = 60;
    reasons.push("calm macro, neutral weather");
  } else {
    reasons.push("mixed signals");
  }

  return { regime, confidence: Math.round(confidence), reasons };
}
