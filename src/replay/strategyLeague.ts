import type { DecisionThresholds } from "../scoring/decisionCaps.js";

// §Phase 6 strategy league: 6 paper-only strategies that each score the same
// recorded events under different thresholds. Their relative performance yields
// BOUNDED suggested weights (never auto-applied to live settings).

export interface Strategy {
  name: string;
  thresholds: DecisionThresholds;
}

const W = { organic: 15, momentum: 30, graduation: 12, devReputation: 12, smartMoney: 18, social: 8, hype: 5 };

export const LEAGUE_STRATEGIES: Strategy[] = [
  { name: "balanced", thresholds: { minConvictionBuySmall: 55, minConvictionBuyStrong: 72, maxLateEntryRisk: 70, minOrganicScore: 55, weights: W } },
  { name: "conservative", thresholds: { minConvictionBuySmall: 62, minConvictionBuyStrong: 80, maxLateEntryRisk: 55, minOrganicScore: 62, weights: W } },
  { name: "aggressive", thresholds: { minConvictionBuySmall: 48, minConvictionBuyStrong: 65, maxLateEntryRisk: 80, minOrganicScore: 50, weights: W } },
  { name: "organic-purist", thresholds: { minConvictionBuySmall: 55, minConvictionBuyStrong: 72, maxLateEntryRisk: 65, minOrganicScore: 70, weights: W } },
  { name: "early-only", thresholds: { minConvictionBuySmall: 55, minConvictionBuyStrong: 72, maxLateEntryRisk: 40, minOrganicScore: 55, weights: W } },
  { name: "momentum-chaser", thresholds: { minConvictionBuySmall: 52, minConvictionBuyStrong: 70, maxLateEntryRisk: 75, minOrganicScore: 52, weights: { ...W, momentum: 45, hype: 3 } } },
];

/** Bounded [0.5, 1.5] weights from each strategy's PnL (suggestion only). */
export function leagueWeights(pnls: Array<{ name: string; totalPnlSol: number }>): Record<string, number> {
  if (pnls.length === 0) return {};
  const max = Math.max(...pnls.map((p) => Math.abs(p.totalPnlSol)), 1);
  const out: Record<string, number> = {};
  for (const p of pnls) out[p.name] = Math.max(0.5, Math.min(1.5, 1 + (p.totalPnlSol / max) * 0.5));
  return out;
}
