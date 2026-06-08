import { clamp } from "./conviction.js";

// §1.4 Late-entry filter → TOO_LATE. A transparent additive risk model (0..100):
// the signal can be correct but the entry already gone. Higher = later/worse.

export interface LateEntryInputs {
  /** % price gain since first observed (e.g. 180 = +180%). */
  priceGainPctSinceFirstSeen?: number;
  /** Bonding-curve fill toward graduation, 0..1. */
  bondingCurveProgress?: number;
  /** Buyer-velocity trend: -1 declining .. +1 accelerating. */
  buyerVelocityTrend?: number;
  /** Whether any meaningful pullback has been seen (vertical w/ none = riskier). */
  pullbackSeen?: boolean;
  /** How far below current price smart money entered (e.g. 60 = they got in 60% lower). */
  smartMoneyEntryDiscountPct?: number;
  /** Estimated slippage for a typical entry (%). Poor slippage = thin/late. */
  estimatedSlippagePct?: number;
  /** Decision-time DexScreener 5-minute price change % (FREE feed). Both extremes
   *  are risky: a big positive spike = blow-off/mean-reversion top; a sharp
   *  negative = buying into an active dump (falling knife). */
  recentPriceChangeM5Pct?: number;
  /** Decision-time DexScreener 1-hour price change % (FREE feed). Large = already ran. */
  recentPriceChangeH1Pct?: number;
}

export interface LateEntryResult {
  risk: number;
  reasons: string[];
}

export function lateEntryRisk(i: LateEntryInputs): LateEntryResult {
  let risk = 0;
  const reasons: string[] = [];

  const gain = i.priceGainPctSinceFirstSeen ?? 0;
  if (gain >= 300) {
    risk += 45;
    reasons.push(`price already +${Math.round(gain)}% (parabolic)`);
  } else if (gain >= 180) {
    risk += 35;
    reasons.push(`price already +${Math.round(gain)}%`);
  } else if (gain >= 100) {
    risk += 20;
    reasons.push(`price already +${Math.round(gain)}%`);
  } else if (gain >= 50) {
    risk += 8;
  }

  const curve = i.bondingCurveProgress ?? 0;
  if (curve >= 0.9) {
    risk += 20;
    reasons.push("bonding curve nearly full");
  } else if (curve >= 0.75) {
    risk += 12;
    reasons.push("bonding curve high");
  } else if (curve >= 0.6) {
    risk += 5;
  }

  const trend = i.buyerVelocityTrend ?? 0;
  if (trend <= -0.5) {
    risk += 20;
    reasons.push("buyer velocity declining sharply");
  } else if (trend < 0) {
    risk += 10;
    reasons.push("buyer velocity declining");
  }

  if (i.pullbackSeen === false && gain >= 100) {
    risk += 10;
    reasons.push("vertical run with no pullback");
  }

  const discount = i.smartMoneyEntryDiscountPct ?? 0;
  if (discount >= 70) {
    risk += 15;
    reasons.push("smart money entered far below current price");
  } else if (discount >= 40) {
    risk += 8;
    reasons.push("smart money entered well below current price");
  }

  const slip = i.estimatedSlippagePct ?? 0;
  if (slip >= 15) {
    risk += 12;
    reasons.push("entry slippage poor (thin liquidity)");
  } else if (slip >= 8) {
    risk += 5;
  }

  // DexScreener 5-minute price change (the FREE run-up signal the guard was
  // missing). A fresh spike is mean-reversion/blow-off risk (we'd be buying the
  // local top — the −22% median @5m loser tail); a sharp drop is a falling knife.
  const m5 = i.recentPriceChangeM5Pct;
  if (m5 !== undefined) {
    if (m5 >= 100) {
      risk += 30;
      reasons.push(`m5 spike +${Math.round(m5)}% (blow-off top risk)`);
    } else if (m5 >= 50) {
      risk += 18;
      reasons.push(`m5 spike +${Math.round(m5)}%`);
    } else if (m5 >= 25) {
      risk += 8;
    } else if (m5 <= -35) {
      risk += 22;
      reasons.push(`m5 dumping ${Math.round(m5)}% (falling knife)`);
    } else if (m5 <= -15) {
      risk += 10;
      reasons.push(`m5 falling ${Math.round(m5)}%`);
    }
  }

  // DexScreener 1-hour price change: already-ran context (modest weight; for a
  // pump.fun newborn this is near-launch, so it is corroborating, not decisive).
  const h1 = i.recentPriceChangeH1Pct;
  if (h1 !== undefined) {
    if (h1 >= 500) {
      risk += 18;
      reasons.push(`h1 already +${Math.round(h1)}%`);
    } else if (h1 >= 250) {
      risk += 10;
    } else if (h1 >= 120) {
      risk += 5;
    }
  }

  return { risk: clamp(risk), reasons };
}
