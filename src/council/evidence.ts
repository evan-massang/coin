import type { GraphIntel } from "../types.js";
import type { CouncilEvidence } from "../aiComputer/councilShared.js";

// Phase 4: the council consumes the engine's INTERPRETED signals (Graph
// Intelligence / Evidence / Confidence), never raw blockchain data. This maps a
// GraphIntel (+ market regime) into the evidence-only payload the seats review.

export function evidenceFromIntel(intel: GraphIntel, marketRegime?: string): CouncilEvidence {
  const has = (t: string) => intel.entities.some((e) => e.type === t);
  const devEntity = intel.entities.find((e) => e.type === "DEV");
  const winnersPoint = intel.bull.find((b) => /historical winner/i.test(b.label));
  const similarWinners = winnersPoint ? parseInt(winnersPoint.label.replace(/\D+/g, ""), 10) || 0 : 0;
  return {
    symbol: intel.symbol,
    state: intel.state,
    coverage: intel.coverage,
    convictionTier: intel.convictionTier,
    bullCount: intel.bull.length,
    bearCount: intel.bear.length,
    bullPoints: intel.bull.slice(0, 6).map((b) => b.label),
    bearPoints: intel.bear.slice(0, 6).map((b) => b.label),
    clusterDetected: has("CLUSTER"),
    smartMoney: has("SMART_MONEY"),
    devSold: devEntity?.sub === "sold",
    rugMatch: has("KNOWN_RUG"),
    marketRegime,
    similarWinners,
  };
}

/** Sparse evidence when a mint hasn't been scored yet — honest "not enough data". */
export function sparseEvidence(symbol: string | undefined, marketRegime?: string): CouncilEvidence {
  return {
    symbol,
    state: "DISCOVERED",
    coverage: 0,
    convictionTier: "LOW",
    bullCount: 0,
    bearCount: 0,
    bullPoints: [],
    bearPoints: ["engine has not finished observing this token yet"],
    clusterDetected: false,
    smartMoney: false,
    devSold: false,
    rugMatch: false,
    marketRegime,
    similarWinners: 0,
  };
}
