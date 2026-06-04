// Convert a suggested risk % into an actual (paper) SOL size, capped by the
// max-position setting and available balance. Advisory / paper-only.
export function sizeFromRiskPct(riskPct: number, balanceSol: number, maxPositionSol: number): number {
  if (riskPct <= 0 || balanceSol <= 0) return 0;
  const bySize = (balanceSol * riskPct) / 100;
  return Math.max(0, Math.min(bySize, maxPositionSol, balanceSol));
}
