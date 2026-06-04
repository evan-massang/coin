import { clamp } from "../scoring/conviction.js";

// §1.6 module 5 — graduation predictor. pump.fun tokens "graduate" to PumpSwap
// at ~$69k market cap. Score combines how far the bonding curve has filled with
// how fast it's filling. Also informs exit timing (a stalled curve near the top
// is a warning). Pure.

/** Approx graduation market cap in SOL (≈ $69k at ~$150/SOL). Tunable later. */
export const GRAD_MCAP_SOL = 460;

export interface GraduationResult {
  score: number;
  progress: number; // 0..1
  fillVelocityPerMin: number;
  reasons: string[];
}

export function progressFromMcapSol(mcapSol: number | undefined): number {
  if (!mcapSol || mcapSol <= 0) return 0;
  return clamp(mcapSol / GRAD_MCAP_SOL, 0, 1);
}

export function computeGraduation(progress: number, fillVelocityPerMin: number): GraduationResult {
  const reasons: string[] = [];
  const p = clamp(progress, 0, 1);

  // Base on how far along, plus a bonus for healthy fill velocity.
  const base = p * 60;
  const velocityBonus = clamp(fillVelocityPerMin * 200, 0, 40); // 0.2/min ⇒ full bonus
  let score = base + velocityBonus;

  if (p >= 0.95) reasons.push("about to graduate");
  else if (p >= 0.6) reasons.push(`curve ${(p * 100).toFixed(0)}% filled`);
  if (fillVelocityPerMin > 0.05) reasons.push("curve filling steadily");
  else if (p > 0.3 && fillVelocityPerMin <= 0) {
    reasons.push("curve fill stalled");
    score *= 0.7;
  }

  return { score: Math.round(clamp(score, 0, 100)), progress: p, fillVelocityPerMin, reasons };
}
