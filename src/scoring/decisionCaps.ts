import type { Decision, ScoreBreakdown, SafetyResult, Verdict } from "../types.js";
import { computeConviction, realCoverage, clamp, type ConvictionWeights, type FacetConfidence } from "./conviction.js";

// ─────────────────────────────────────────────────────────────────────────────
// GATE → SCORE → CAP → VERDICT (§1.6). Priority order is strict:
//   1 Safety (hard gate)  2 Organic volume  3 Late-entry risk
//   4 Momentum  5 Graduation  6 Dev  7 Smart money  8 Social  9 AI narrative
// Safety is never a weight; AI narrative can never override safety or force BUY.
// ─────────────────────────────────────────────────────────────────────────────

/** Hard organic floor: below this is an outright AVOID (§1.3). */
export const ORGANIC_AVOID = 30;
/** Below this, conviction is capped to WATCH territory (§1.3 / §1.6 "cap 49"). */
export const ORGANIC_WATCH = 45;
/** Conviction cap applied when organic is in the WATCH band. */
export const ORGANIC_WATCH_CAP = 49;
/** Conviction cap applied when ≥2 safety checks are UNKNOWN (§1.6). */
export const UNKNOWN_CAP = 59;
/** Conviction cap applied when organic is below the user's min but ≥ WATCH band. */
export const ORGANIC_SOFT_CAP = 59;
/** Conviction cap when too few REAL-evidence facets actually computed (Cycle 1 fix). */
export const LOW_COVERAGE_CAP = 49;
/** Minimum conviction to surface as WATCH_ONLY rather than AVOID. */
export const WATCH_MIN_CONVICTION = 40;

export interface DecisionThresholds {
  minConvictionBuySmall: number;
  minConvictionBuyStrong: number;
  maxLateEntryRisk: number;
  /** User's minimum organic score; below it (but ≥ WATCH band) soft-caps conviction. */
  minOrganicScore: number;
  weights: ConvictionWeights;
}

export interface DecisionInput {
  mint: string;
  symbol?: string;
  name?: string;
  scores: ScoreBreakdown;
  safety: SafetyResult;
  thresholds: DecisionThresholds;
  /** Extra human-readable reasons from upstream scorers. */
  reasons?: string[];
  flags?: string[];
  /** Per-facet confidence (0..1). Absent ⇒ all facets trusted (legacy behaviour). */
  confidence?: FacetConfidence;
  /** Facets below this confidence are dropped from the conviction blend (default 0.5). */
  convictionFloor?: number;
  /** If real-evidence coverage falls below this, conviction is capped to WATCH (default 0.5). */
  minRealCoverage?: number;
  at: number;
}

export function decide(input: DecisionInput): Decision {
  const { scores, safety, thresholds } = input;
  const reasons = [...(input.reasons ?? [])];
  const flags = [...(input.flags ?? [])];
  const caps: string[] = [];

  // Base conviction (gate scores excluded). Confidence-aware: frozen/unknown
  // facets are dropped rather than anchoring conviction at a neutral default.
  const floor = input.convictionFloor ?? 0.5;
  const base = computeConviction(scores, thresholds.weights, input.confidence, floor);

  const mk = (verdict: Verdict, conviction: number): Decision => ({
    mint: input.mint,
    symbol: input.symbol,
    name: input.name,
    verdict,
    conviction: Math.round(clamp(conviction)),
    scores,
    reasons,
    flags,
    caps,
    at: input.at,
  });

  // 1. SAFETY — hard gate. A failed gate is AVOID no matter how strong anything
  //    else is (including a perfect AI hype score).
  if (!safety.pass) {
    reasons.unshift(
      `Safety gate failed: ${safety.fatalReasons.join("; ") || "fatal safety check"}`,
    );
    return mk("AVOID", 0);
  }

  // 2. ORGANIC VOLUME — hard floor (60–80% of volume is bots; §1.3).
  if (scores.organic < ORGANIC_AVOID) {
    reasons.unshift(`Organic volume too low (${Math.round(scores.organic)} < ${ORGANIC_AVOID})`);
    flags.push("wash-volume");
    return mk("AVOID", Math.min(base, 25));
  }

  // 3. LATE-ENTRY — hard verdict. Correct signal, but the entry is gone (§1.4).
  if (scores.lateEntryRisk > thresholds.maxLateEntryRisk) {
    reasons.unshift(
      `Too late: late-entry risk ${Math.round(scores.lateEntryRisk)} > ${thresholds.maxLateEntryRisk}`,
    );
    caps.push("lateEntry⇒TOO_LATE");
    return mk("TOO_LATE", base);
  }

  // 4–9. SCORE then CAP.
  let conviction = base;

  if (scores.organic < ORGANIC_WATCH) {
    conviction = Math.min(conviction, ORGANIC_WATCH_CAP);
    caps.push(`organic<${ORGANIC_WATCH}⇒cap ${ORGANIC_WATCH_CAP}`);
    flags.push("low-organic");
  } else if (scores.organic < thresholds.minOrganicScore) {
    conviction = Math.min(conviction, ORGANIC_SOFT_CAP);
    caps.push(`organic<${thresholds.minOrganicScore}⇒cap ${ORGANIC_SOFT_CAP}`);
  }

  // Cap conviction only when FATAL-capable safety props (mint/freeze authority)
  // can't be verified — NOT when paid-only data (holders/bundle) is merely absent.
  // (Cycle 7: the old all-unknowns count pegged 100% of BUYs at 59.) Falls back to
  // unknownCount for legacy/backtest rows that predate fatalUnknownCount.
  const capUnknowns = safety.fatalUnknownCount ?? safety.unknownCount;
  if (capUnknowns >= 2) {
    conviction = Math.min(conviction, UNKNOWN_CAP);
    caps.push(`${capUnknowns} unverified fatal-safety items⇒cap ${UNKNOWN_CAP}`);
    flags.push("safety-unknowns");
  }

  // Real-evidence coverage gate: if too little genuine evidence actually computed
  // (e.g. token scored on <8 trades ⇒ organic/momentum unknown), cap to WATCH so
  // a thin token can't reach BUY on the social/hype anchors alone (Cycle 1 fix).
  const rc = realCoverage(thresholds.weights, input.confidence, floor);
  if (rc < (input.minRealCoverage ?? 0.5)) {
    conviction = Math.min(conviction, LOW_COVERAGE_CAP);
    caps.push(`low-coverage(${Math.round(rc * 100)}%)⇒cap ${LOW_COVERAGE_CAP}`);
    flags.push("low-coverage");
  }

  // Map capped conviction → verdict.
  let verdict: Verdict;
  if (conviction >= thresholds.minConvictionBuyStrong) verdict = "BUY_STRONG";
  else if (conviction >= thresholds.minConvictionBuySmall) verdict = "BUY_SMALL";
  else if (conviction >= WATCH_MIN_CONVICTION) verdict = "WATCH_ONLY";
  else verdict = "AVOID";

  return mk(verdict, conviction);
}
