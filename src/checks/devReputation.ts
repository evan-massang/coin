// Dev-wallet reputation (§1.6 module 6). Pure scoring from whatever dev signals
// we have. Unknown defaults to a mild positive baseline so it neither forces nor
// blocks a BUY on its own.

export interface DevRepInputs {
  devSold?: boolean;
  devHoldingPct?: number;
  priorRugCount?: number;
  priorTokenCount?: number;
}

export interface DevRepResult {
  score: number;
  reasons: string[];
}

export function computeDevReputation(i: DevRepInputs): DevRepResult {
  const reasons: string[] = [];
  let score = 60;

  if (i.devSold) {
    score -= 35;
    reasons.push("dev wallet sold");
  }
  if (i.devHoldingPct !== undefined) {
    if (i.devHoldingPct > 15) {
      score -= 20;
      reasons.push(`dev holds ${i.devHoldingPct.toFixed(0)}%`);
    } else if (i.devHoldingPct > 10) {
      score -= 10;
    }
  }
  if (i.priorRugCount && i.priorRugCount > 0) {
    score -= Math.min(50, i.priorRugCount * 25);
    reasons.push(`${i.priorRugCount} prior rug(s)`);
  } else if (i.priorTokenCount && i.priorTokenCount >= 3) {
    score += 10;
    reasons.push("serial dev, no known rugs");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
