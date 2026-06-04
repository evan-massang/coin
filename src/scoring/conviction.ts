import type { ScoreBreakdown } from "../types.js";

// Base conviction = weighted average of the *non-gate* sub-scores. Safety and
// lateEntryRisk are deliberately excluded — they are a gate and a cap, not
// weights (§1.6). The hype weight is small by design, which structurally
// prevents AI narrative from being the sole BUY trigger: hype=100 with every
// other score 0 yields conviction ≈ weightHype/totalWeight (a few points).

export interface ConvictionWeights {
  organic: number;
  momentum: number;
  graduation: number;
  devReputation: number;
  smartMoney: number;
  social: number;
  hype: number;
}

export function clamp(x: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, x));
}

export function computeConviction(scores: ScoreBreakdown, w: ConvictionWeights): number {
  const pairs: Array<[number, number]> = [
    [scores.organic, w.organic],
    [scores.momentum, w.momentum],
    [scores.graduation, w.graduation],
    [scores.devReputation, w.devReputation],
    [scores.smartMoney, w.smartMoney],
    [scores.social, w.social],
    [scores.hype, w.hype],
  ];
  const totalW = pairs.reduce((a, [, wt]) => a + wt, 0);
  if (totalW <= 0) return 0;
  const sum = pairs.reduce((a, [s, wt]) => a + clamp(s) * wt, 0);
  return clamp(sum / totalW);
}
