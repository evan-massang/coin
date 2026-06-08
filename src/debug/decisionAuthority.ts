import type { ScoreBreakdown } from "../types.js";
import { type ConvictionWeights, type FacetConfidence, clamp } from "../scoring/conviction.js";
import { decide, type DecisionInput, type DecisionThresholds } from "../scoring/decisionCaps.js";

// Project Athena Phase 17/18/22 — Decision Authority & Influence.
// Answers the dangerous question: "is Athena actually CONTROLLING the decision, or
// just watching?" by (a) decomposing conviction into each facet's contribution, and
// (b) re-deciding WITH vs WITHOUT the attention facet (Athena vs legacy). PURE +
// deterministic — mirrors computeConviction's confidence-gated blend exactly.

export interface FacetContribution {
  facet: string;
  score: number;
  weight: number;
  confidence: number;
  included: boolean; // counted in the blend (weight>0 AND confidence>=floor)
  contributionPts: number; // points of the FINAL conviction this facet supplied (Σ = conviction)
  sharePct: number; // contribution as % of the final conviction
}

export interface InfluenceBreakdown {
  conviction: number;
  contributions: FacetContribution[]; // sorted, biggest contributor first
  /** attention's share of the final conviction (0..100). */
  attentionInfluencePct: number;
  /** true when attention evidence is present (score>0 / has confidence) yet its
   *  influence on conviction is ~0 — i.e. research isn't actually affecting trading. */
  attentionPresentButIgnored: boolean;
}

/** Decompose a conviction blend into per-facet contributions (Phase 18). */
export function convictionContributions(
  scores: ScoreBreakdown,
  weights: ConvictionWeights,
  confidence: FacetConfidence = {},
  floor = 0.5,
): InfluenceBreakdown {
  const facets = Object.keys(weights) as (keyof ConvictionWeights)[];
  let keptW = 0;
  const rows = facets.map((f) => {
    const weight = weights[f] ?? 0;
    const conf = confidence[f] ?? 1;
    const included = weight > 0 && conf >= floor;
    if (included) keptW += weight;
    return { facet: String(f), score: clamp(scores[f] ?? 0), weight, confidence: conf, included };
  });

  const conviction = keptW > 0 ? clamp(rows.filter((r) => r.included).reduce((s, r) => s + r.score * r.weight, 0) / keptW) : 0;

  const contributions: FacetContribution[] = rows
    .map((r) => {
      const contributionPts = r.included && keptW > 0 ? (r.score * r.weight) / keptW : 0;
      return { ...r, contributionPts, sharePct: conviction > 0 ? (contributionPts / conviction) * 100 : 0 };
    })
    .sort((a, b) => b.contributionPts - a.contributionPts);

  const attn = contributions.find((c) => c.facet === "attention");
  const attentionInfluencePct = attn?.sharePct ?? 0;
  // "present" = we have an attention reading (a score or some confidence), regardless
  // of whether it was actually counted.
  const attnPresent = (scores.attention ?? 0) > 0 || (confidence.attention ?? 0) > 0;
  const attentionPresentButIgnored = attnPresent && attentionInfluencePct < 1;

  return { conviction, contributions, attentionInfluencePct, attentionPresentButIgnored };
}

export interface LegacyVsAthena {
  legacy: { verdict: string; conviction: number };
  athena: { verdict: string; conviction: number };
  diverged: boolean; // attention changed the verdict
  convictionDelta: number; // athena − legacy
}

/** Re-decide WITH vs WITHOUT the attention facet (Phase 22). If they never diverge,
 *  attention is decorative; if they do, Athena is genuinely steering the verdict. */
export function legacyVsAthena(input: DecisionInput): LegacyVsAthena {
  const athena = decide(input);
  const legacyThresholds: DecisionThresholds = { ...input.thresholds, weights: { ...input.thresholds.weights, attention: 0 } };
  const legacy = decide({ ...input, thresholds: legacyThresholds });
  return {
    legacy: { verdict: legacy.verdict, conviction: legacy.conviction },
    athena: { verdict: athena.verdict, conviction: athena.conviction },
    diverged: legacy.verdict !== athena.verdict,
    convictionDelta: athena.conviction - legacy.conviction,
  };
}
