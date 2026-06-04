// §Phase 4 source agreement. When independent sources disagree (e.g. RugCheck
// says clean but the observed trade stream looks bundled), trust the signal
// less. Conflicts shrink the MiroFish size; confirmations nudge it up. Pure.

export interface SourceAgreementInputs {
  rugcheckClean?: boolean;
  bundleBad?: boolean;
  liquidityHealthy?: boolean;
  holderBad?: boolean;
  momentumStrong?: boolean;
  /** Multiplier applied when there are conflicts (from settings). */
  sourceConflictMultiplier: number;
}

export interface SourceAgreementResult {
  score: number;
  multiplier: number;
  conflicts: string[];
  confirmations: string[];
}

export function computeSourceAgreement(i: SourceAgreementInputs): SourceAgreementResult {
  const conflicts: string[] = [];
  const confirmations: string[] = [];

  if (i.rugcheckClean && i.bundleBad) conflicts.push("RugCheck clean but observed trades look bundled");
  if (i.liquidityHealthy && i.holderBad) conflicts.push("healthy liquidity but concentrated holders");

  if (i.rugcheckClean && i.liquidityHealthy) confirmations.push("safety + liquidity agree");
  if (i.momentumStrong && i.rugcheckClean) confirmations.push("momentum on a clean token");

  let score = 70;
  score -= conflicts.length * 30;
  score += confirmations.length * 10;
  score = Math.max(0, Math.min(100, score));

  const multiplier = conflicts.length > 0 ? i.sourceConflictMultiplier : confirmations.length >= 2 ? 1.1 : 1.0;
  return { score, multiplier, conflicts, confirmations };
}
