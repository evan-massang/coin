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
  /** Enforce the late-entry guard (return TOO_LATE) vs SHADOW (record + flag, no
   *  block). Default true preserves legacy/test behavior; the live engine ships
   *  SHADOW (false) until forward run-up→outcome data calibrates the threshold. */
  lateEntryEnforce?: boolean;
  /** User's minimum organic score; below it (but ≥ WATCH band) soft-caps conviction. */
  minOrganicScore: number;
  /** Min momentum facet to allow a BUY (Cycle 7 audit edge: momentum≥85 ≈2× the 2x
   *  hit-rate). 0 = off. Below it, a would-be BUY is held to WATCH. */
  minMomentumForBuy?: number;
  /** Momentum CEILING: hold a would-be BUY to WATCH when momentum ≥ this (0 = off).
   *  Cycle-8: high momentum = chasing a spike; it is the dominant ANTI-predictive
   *  driver of realized PnL (momentum<70 halves the per-trade loss in backtest). */
  maxMomentumForBuy?: number;
  /** Run-up CEILING: hold a would-be BUY to WATCH when the recorded 5m run-up
   *  (scores.recentM5Pct) exceeds this % (0 = off). Cycle-8: realized PnL collapses
   *  for already-popped coins (m5 25–75% → −16% realized vs −7% for 0–25%). */
  maxEntryRunupM5Pct?: number;
  /** Athena Readiness Gate (Phase 21): hold a would-be BUY at WATCH until attention
   *  research has RUN (confidence.attention > 0). Makes attention gate executed buys. */
  attentionReadinessGate?: boolean;
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
  /** Whether attention research has RUN for this coin (Phase 21 readiness gate). When
   *  the gate is on, a would-be BUY is held to WATCH until this is true — then it's
   *  decided on merit (the attention facet contributes only if it found evidence). A
   *  coin with NO external footprint researches to empty, so it's never blocked
   *  forever — it's bought on fundamentals once we've confirmed there's no attention. */
  attentionResearched?: boolean;
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

  // 3. LATE-ENTRY — hard verdict when ENFORCED. The guard's run-up input is now fed
  //    the FREE DexScreener m5/h1 price change (historically it read the empty trade
  //    buffer, so it never fired: 0/19k TOO_LATE, risk capped at 40 < 70). Default is
  //    SHADOW (record + flag, do NOT block) until forward run-up→outcome data
  //    calibrates the threshold — winners dip before they rip, so blocking blind
  //    would repeat the refuted "exit-if-red" mistake.
  if (scores.lateEntryRisk > thresholds.maxLateEntryRisk) {
    if (thresholds.lateEntryEnforce ?? true) {
      reasons.unshift(
        `Too late: late-entry risk ${Math.round(scores.lateEntryRisk)} > ${thresholds.maxLateEntryRisk}`,
      );
      caps.push("lateEntry⇒TOO_LATE");
      return mk("TOO_LATE", base);
    }
    flags.push("late-entry-shadow");
    caps.push(`lateEntry ${Math.round(scores.lateEntryRisk)}>${thresholds.maxLateEntryRisk} (shadow — would block)`);
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

  // Safety-data unknowns no longer CAP conviction (Cycle 7). On a pump.fun-only
  // free feed the unknowns are STRUCTURAL and permanent — authorities are
  // curve-held (not "revoked"), and holders/bundle/dev-movement need the paid
  // feed — so counting them pegged 100% of BUYs at 59 and made BUY_STRONG
  // unreachable. Protection is preserved elsewhere: the safety GATE still AVOIDs
  // confirmed-bad tokens, the LOW_COVERAGE_CAP below still requires real
  // DexScreener evidence to BUY, and the risk engine still shrinks position size
  // when blind. We keep the flag purely for transparency (it's surfaced in the UI).
  if ((safety.unknownCount ?? 0) >= 2) flags.push("safety-unknowns");

  // Real-evidence coverage gate: if too little genuine evidence actually computed
  // (e.g. token scored on <8 trades ⇒ organic/momentum unknown), cap to WATCH so
  // a thin token can't reach BUY on the social/hype anchors alone (Cycle 1 fix).
  const rc = realCoverage(thresholds.weights, input.confidence, floor);
  if (rc < (input.minRealCoverage ?? 0.5)) {
    conviction = Math.min(conviction, LOW_COVERAGE_CAP);
    caps.push(`low-coverage(${Math.round(rc * 100)}%)⇒cap ${LOW_COVERAGE_CAP}`);
    flags.push("low-coverage");
  }

  // Momentum floor (Cycle 7 audit edge): hold a would-be BUY to WATCH if its
  // momentum is below the floor. Audit: momentum≥85 ≈ doubles the 2x hit-rate
  // (significant, holds out-of-sample). Off (0) by default — flip on after ≥1wk
  // of multi-regime data confirms it (the audit's window was one 3.7h session).
  const momFloor = thresholds.minMomentumForBuy ?? 0;
  if (momFloor > 0 && scores.momentum < momFloor && conviction >= thresholds.minConvictionBuySmall) {
    conviction = Math.min(conviction, thresholds.minConvictionBuySmall - 1);
    caps.push(`momentum ${Math.round(scores.momentum)}<${momFloor}⇒WATCH`);
    flags.push("low-momentum");
  }

  // Momentum CEILING (Cycle 8): a HOT momentum facet means we're chasing a spike
  // that mean-reverts. Backtest on 1,239 resolved BUYs: momentum is the dominant
  // ANTI-predictive driver of REALIZED PnL — momentum<70 ⇒ realized mid −8% vs −17%
  // for all BUYs (pessimistic −12.5% vs −25.7%). Hold a would-be BUY to WATCH. The
  // ceiling, when set, takes precedence over the (peak-oriented) floor. 0 = off.
  const momCeil = thresholds.maxMomentumForBuy ?? 0;
  if (momCeil > 0 && scores.momentum >= momCeil && conviction >= thresholds.minConvictionBuySmall) {
    conviction = Math.min(conviction, thresholds.minConvictionBuySmall - 1);
    caps.push(`momentum ${Math.round(scores.momentum)}≥${momCeil}⇒WATCH (chase)`);
    flags.push("high-momentum-chase");
  }

  // Run-up CEILING (Cycle 8, calibrated on 2,760 resolved signals WITH recorded
  // run-up): already-popped coins realize far worse — m5 25–75% → −16% realized vs
  // −7% for 0–25%, and the near-breakeven band (−1.4%) is m5 ≤ 0. Hold a would-be
  // BUY to WATCH when the recorded 5m run-up exceeds the ceiling. 0 = off.
  const maxRunup = thresholds.maxEntryRunupM5Pct ?? 0;
  const m5 = scores.recentM5Pct ?? 0;
  if (maxRunup > 0 && m5 > maxRunup && conviction >= thresholds.minConvictionBuySmall) {
    conviction = Math.min(conviction, thresholds.minConvictionBuySmall - 1);
    caps.push(`run-up m5 ${Math.round(m5)}%>${maxRunup}⇒WATCH (chase)`);
    flags.push("run-up-chase");
  }

  // Map capped conviction → verdict.
  let verdict: Verdict;
  if (conviction >= thresholds.minConvictionBuyStrong) verdict = "BUY_STRONG";
  else if (conviction >= thresholds.minConvictionBuySmall) verdict = "BUY_SMALL";
  else if (conviction >= WATCH_MIN_CONVICTION) verdict = "WATCH_ONLY";
  else verdict = "AVOID";

  // Athena Readiness Gate (Phase 21): don't EXECUTE a BUY before attention research
  // has actually RUN for this coin — hold it at WATCH (which triggers research); the
  // re-score, once research lands, makes the real attention-informed buy. This is what
  // makes attention GATE executed trades instead of just watching after the fact.
  // KEY: the gate keys on whether research has RUN, NOT on a positive attention score —
  // a coin with no external footprint researches to empty (confidence 0) and is then
  // bought on fundamentals, so the gate never deadlocks the engine's newborn universe.
  if (thresholds.attentionReadinessGate && (verdict === "BUY_SMALL" || verdict === "BUY_STRONG") && !input.attentionResearched) {
    caps.push("awaiting-attention⇒WATCH");
    flags.push("awaiting-attention");
    verdict = "WATCH_ONLY";
  }

  return mk(verdict, conviction);
}
