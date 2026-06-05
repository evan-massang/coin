import type { ScoreBreakdown } from "../types.js";

// Base conviction = weighted average of the *non-gate* sub-scores. Safety and
// lateEntryRisk are deliberately excluded — they are a gate and a cap, not
// weights (§1.6). The hype weight is small by design, which structurally
// prevents AI narrative from being the sole BUY trigger.
//
// Confidence-aware (research Cycle 1 fix): a facet is only blended in when its
// confidence ≥ floor. Facets that can't compute (organic on <8 trades,
// smartMoney with no tracked wallets, devReputation with no data) are EXCLUDED
// from both numerator and denominator instead of anchoring conviction at a
// frozen neutral default — so REAL evidence can express. `realCoverage` reports
// how much *real* evidence (excluding the social/hype anchors) actually counted,
// so a thin token can't clear the gate on social+hype alone.

export interface ConvictionWeights {
  organic: number;
  momentum: number;
  graduation: number;
  devReputation: number;
  smartMoney: number;
  social: number;
  hype: number;
}

export type FacetConfidence = Partial<Record<keyof ConvictionWeights, number>>;

const ALL_FACETS: (keyof ConvictionWeights)[] = ["organic", "momentum", "graduation", "devReputation", "smartMoney", "social", "hype"];
/** "Real" evidence facets — social + hype (narrative anchors) are excluded. */
export const REAL_FACETS: (keyof ConvictionWeights)[] = ["organic", "momentum", "graduation", "devReputation", "smartMoney"];

export function clamp(x: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Weighted-average conviction over facets whose confidence ≥ floor. Absent
 * confidence defaults to 1 (fully trusted) so every legacy caller (and the
 * backtester) reproduces the old verdict exactly.
 */
export function computeConviction(scores: ScoreBreakdown, w: ConvictionWeights, confidence: FacetConfidence = {}, floor = 0.5): number {
  let sum = 0;
  let keptW = 0;
  for (const f of ALL_FACETS) {
    if ((confidence[f] ?? 1) < floor) continue; // drop low-confidence facet entirely
    sum += clamp(scores[f]) * w[f];
    keptW += w[f];
  }
  if (keptW <= 0) return 0;
  return clamp(sum / keptW);
}

/** Fraction of REAL-evidence weight (excl. social/hype) that is confident enough to count, 0..1. */
export function realCoverage(w: ConvictionWeights, confidence: FacetConfidence = {}, floor = 0.5): number {
  let total = 0;
  let kept = 0;
  for (const f of REAL_FACETS) {
    total += w[f];
    if ((confidence[f] ?? 1) >= floor) kept += w[f];
  }
  return total > 0 ? kept / total : 0;
}
