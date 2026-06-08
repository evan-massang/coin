import type { Settings } from "../store/settingsStore.js";
import type { DecisionThresholds } from "./decisionCaps.js";

/** Map user settings → the thresholds + weights the scoring pipeline uses. */
export function thresholdsFromSettings(s: Settings): DecisionThresholds {
  return {
    minConvictionBuySmall: s.minConvictionBuySmall,
    minConvictionBuyStrong: s.minConvictionBuyStrong,
    maxLateEntryRisk: s.maxLateEntryRisk,
    lateEntryEnforce: s.lateEntryEnforce,
    minOrganicScore: s.minOrganicScore,
    minMomentumForBuy: s.minMomentumForBuy,
    maxMomentumForBuy: s.maxMomentumForBuy,
    maxEntryRunupM5Pct: s.maxEntryRunupM5Pct,
    // Gate active only when attention is genuinely on (enabled + weighted), so it
    // never deadlocks buys when attention is off.
    attentionReadinessGate: s.attentionReadinessGate && s.attentionEnabled && s.weightAttention > 0,
    weights: {
      organic: s.weightOrganic,
      momentum: s.weightMomentum,
      graduation: s.weightGraduation,
      devReputation: s.weightDevReputation,
      smartMoney: s.weightSmartMoney,
      social: s.weightSocial,
      hype: s.weightHype,
      attention: s.weightAttention,
    },
  };
}
