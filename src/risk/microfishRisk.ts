import type { RiskContext, RiskDecision, RiskMultipliers, RiskTier } from "./riskTypes.js";

// Pure dynamic risk engine. size% = base × ∏(multipliers), clamped to
// [min,max]. Fatal safety / honeypot / non-BUY ⇒ 0% / NONE. Every multiplier is
// a transparent band so the reasons explain the size.

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function tierFor(pct: number): RiskTier {
  if (pct <= 0) return "NONE";
  if (pct < 0.5) return "TINY";
  if (pct < 1.0) return "LOW";
  if (pct < 1.5) return "MEDIUM";
  return "HIGH";
}

export function computeRisk(ctx: RiskContext): RiskDecision {
  const reasons: string[] = [];
  const isBuy = ctx.verdict === "BUY_SMALL" || ctx.verdict === "BUY_STRONG";

  const none = (reason: string): RiskDecision => {
    reasons.push(reason);
    return {
      verdict: ctx.verdict,
      conviction: ctx.conviction,
      riskTier: "NONE",
      suggestedRiskPct: 0,
      maxPositionSol: ctx.maxPositionSol,
      multipliers: { safety: 0, liquidity: 0, organic: 0, momentum: 0, marketWeather: 1, sourceAgreement: 1, volatility: 1, timeDecay: 1 },
      reasons,
    };
  };

  if (!ctx.safetyPass) return none("safety gate failed");
  if (ctx.honeypot) return none("honeypot");
  if (!isBuy) return none(`not a BUY verdict (${ctx.verdict})`);

  const m: RiskMultipliers = {
    safety: ctx.unknownCount >= 2 ? 0.35 : clamp(0.6 + (ctx.scores.safety / 100) * 0.5, 0.6, 1.1),
    liquidity: liquidityMult(ctx.liquidityUsd, ctx.minLiquidityUsd),
    organic: band(ctx.scores.organic, [70, 1.2], [55, 1.0], [45, 0.7], 0.4),
    momentum: band(ctx.scores.momentum, [80, 1.3], [60, 1.1], [40, 0.9], 0.6),
    marketWeather: ctx.marketWeatherMultiplier ?? 1,
    sourceAgreement: ctx.sourceAgreementMultiplier ?? 1,
    volatility: 1,
    timeDecay: timeDecayMult(ctx.scores.lateEntryRisk),
  };

  const scamMemory = ctx.scamMemoryMultiplier ?? 1;

  if (ctx.unknownCount >= 2) reasons.push("safety unknowns ⇒ ×0.35");
  if (m.liquidity < 0.8) reasons.push("thin/unknown liquidity");
  if (m.marketWeather < 0.9) reasons.push("market risk-off");
  if (m.sourceAgreement < 0.9) reasons.push("source conflict");
  if (m.timeDecay < 0.8) reasons.push("late entry ⇒ size cut");
  if (scamMemory < 1) reasons.push("scam-memory match ⇒ size cut");

  const product =
    m.safety * m.liquidity * m.organic * m.momentum * m.marketWeather * m.sourceAgreement * m.volatility * m.timeDecay * scamMemory;
  const suggestedRiskPct = clamp(ctx.baseRiskPct * product, 0, ctx.maxRiskPct);
  const finalPct = suggestedRiskPct < ctx.minRiskPct ? 0 : suggestedRiskPct;
  const riskTier = tierFor(finalPct);
  reasons.unshift(`${riskTier} — ${finalPct.toFixed(2)}% (base ${ctx.baseRiskPct}% × ${product.toFixed(2)})`);

  return {
    verdict: ctx.verdict,
    conviction: ctx.conviction,
    riskTier,
    suggestedRiskPct: finalPct,
    maxPositionSol: ctx.maxPositionSol,
    multipliers: m,
    reasons,
  };
}

function liquidityMult(usd: number | undefined, min: number): number {
  if (usd === undefined) return 0.8; // unknown — slight caution
  if (usd >= 50_000) return 1.2;
  if (usd >= 10_000) return 1.0;
  if (usd >= min) return 0.8;
  return 0.4;
}

function timeDecayMult(lateEntryRisk: number): number {
  if (lateEntryRisk >= 60) return 0.2;
  if (lateEntryRisk >= 45) return 0.5;
  if (lateEntryRisk >= 30) return 0.8;
  return 1;
}

/** Stepwise band: first [threshold,value] whose threshold is met, else fallback. */
function band(score: number, ...rest: Array<[number, number] | number>): number {
  const fallback = rest[rest.length - 1] as number;
  for (let i = 0; i < rest.length - 1; i++) {
    const [threshold, value] = rest[i] as [number, number];
    if (score >= threshold) return value;
  }
  return fallback;
}
