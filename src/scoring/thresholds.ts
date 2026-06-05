import type { Settings } from "../store/settingsStore.js";
import type { DecisionThresholds } from "./decisionCaps.js";

/** Map user settings → the thresholds + weights the scoring pipeline uses. */
export function thresholdsFromSettings(s: Settings): DecisionThresholds {
  return {
    minConvictionBuySmall: s.minConvictionBuySmall,
    minConvictionBuyStrong: s.minConvictionBuyStrong,
    maxLateEntryRisk: s.maxLateEntryRisk,
    minOrganicScore: s.minOrganicScore,
    minMomentumForBuy: s.minMomentumForBuy,
    weights: {
      organic: s.weightOrganic,
      momentum: s.weightMomentum,
      graduation: s.weightGraduation,
      devReputation: s.weightDevReputation,
      smartMoney: s.weightSmartMoney,
      social: s.weightSocial,
      hype: s.weightHype,
    },
  };
}
