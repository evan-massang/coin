import type { Decision, ScoreBreakdown, SafetyResult, Verdict } from "../types.js";
import { computeConviction, clamp, type ConvictionWeights } from "./conviction.js";

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
  at: number;
}

export function decide(input: DecisionInput): Decision {
  const { scores, safety, thresholds } = input;
  const reasons = [...(input.reasons ?? [])];
  const flags = [...(input.flags ?? [])];
  const caps: string[] = [];

  // Base conviction (gate scores excluded). Computed up front for transparency
  // even on early returns.
  const base = computeConviction(scores, thresholds.weights);

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

  if (safety.unknownCount >= 2) {
    conviction = Math.min(conviction, UNKNOWN_CAP);
    caps.push(`${safety.unknownCount} unknown safety items⇒cap ${UNKNOWN_CAP}`);
    flags.push("safety-unknowns");
  }

  // Map capped conviction → verdict.
  let verdict: Verdict;
  if (conviction >= thresholds.minConvictionBuyStrong) verdict = "BUY_STRONG";
  else if (conviction >= thresholds.minConvictionBuySmall) verdict = "BUY_SMALL";
  else if (conviction >= WATCH_MIN_CONVICTION) verdict = "WATCH_ONLY";
  else verdict = "AVOID";

  return mk(verdict, conviction);
}
