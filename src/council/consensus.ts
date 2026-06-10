import type { CouncilMemberResult, CouncilEvidence } from "../aiComputer/councilShared.js";

// Phase 8: the consensus engine. Not a naive vote — it is a weighted blend of the
// seats' scores plus an agreement measure and the shared evidence the panel
// weighed. Still advisory: the consensus changes nothing in the decision path.

export interface Consensus {
  /** Weighted average favourability, 0-100. */
  score: number;
  recommendation: "confirm" | "caution" | "reject";
  bullModels: number;
  bearModels: number;
  /** Seats that actively rejected (subset of bearModels). */
  rejectModels: number;
  /** % of seats agreeing with the majority direction. */
  agreement: number;
  members: number;
  /** Engine evidence the panel leaned on (direction-appropriate). */
  sharedEvidence: string[];
  rationale: string;
}

export function buildConsensus(
  results: CouncilMemberResult[],
  evidence: CouncilEvidence,
  weights?: Record<string, number>,
): Consensus | undefined {
  if (!results.length) return undefined;
  const w = (r: CouncilMemberResult) => (weights && weights[r.id] && weights[r.id] > 0 ? weights[r.id] : 1);
  const totalW = results.reduce((a, r) => a + w(r), 0);
  const score = Math.round(results.reduce((a, r) => a + r.score * w(r), 0) / totalW);

  const bullModels = results.filter((r) => r.recommendation === "confirm").length;
  const rejectModels = results.filter((r) => r.recommendation === "reject").length;
  const bearModels = results.length - bullModels;
  const agreement = Math.round((Math.max(bullModels, bearModels) / results.length) * 100);
  // Skeptical default: confirm only with a confirming majority AND a healthy
  // weighted score; a rejecting majority is an outright REJECT; else caution.
  const recommendation: Consensus["recommendation"] =
    rejectModels * 2 >= results.length ? "reject" : bullModels > bearModels && score >= 55 ? "confirm" : "caution";

  const sharedEvidence = (recommendation === "confirm" ? evidence.bullPoints : evidence.bearPoints).slice(0, 3);
  const rationale = `${bullModels}/${results.length} bullish · ${rejectModels} reject · agreement ${agreement}% · weighted ${score}`;

  return { score, recommendation, bullModels, bearModels, rejectModels, agreement, members: results.length, sharedEvidence, rationale };
}
