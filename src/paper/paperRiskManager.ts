import type { Verdict } from "../types.js";

// §1.11 Paper auto-buy rules — never buys every signal. BUY_SMALL sizes 1–2% of
// the sim wallet, BUY_STRONG 3–5%, and only when safety passes, organic is above
// threshold, and late-entry risk is low. Respects Max Position Size + Risk Per
// Trade. Pure. (Paper trading is SIMULATION ONLY — no keys, no signing.)

export interface PaperRiskInputs {
  verdict: Verdict;
  balanceSol: number;
  maxPositionSol: number;
  riskPerTradePct: number;
  safetyPass: boolean;
  organicScore: number;
  minOrganicScore: number;
  lateEntryRisk: number;
  maxLateEntryRisk: number;
  liquidityUsd?: number;
  minLiquidityUsd: number;
}

export interface PaperSizing {
  buy: boolean;
  sizeSol: number;
  reasons: string[];
}

const PCT: Partial<Record<Verdict, number>> = {
  BUY_SMALL: 0.015, // 1.5% (band 1–2%)
  BUY_STRONG: 0.04, // 4%   (band 3–5%)
};

export function sizePaperBuy(i: PaperRiskInputs): PaperSizing {
  const reasons: string[] = [];

  const basePct = PCT[i.verdict];
  if (basePct === undefined) return { buy: false, sizeSol: 0, reasons: ["not a BUY verdict"] };
  if (!i.safetyPass) return { buy: false, sizeSol: 0, reasons: ["safety gate failed"] };
  if (i.lateEntryRisk > i.maxLateEntryRisk) return { buy: false, sizeSol: 0, reasons: ["late-entry risk too high"] };
  if (i.organicScore < i.minOrganicScore) return { buy: false, sizeSol: 0, reasons: ["organic score below threshold"] };
  if (i.liquidityUsd !== undefined && i.liquidityUsd < i.minLiquidityUsd) {
    return { buy: false, sizeSol: 0, reasons: ["liquidity too thin"] };
  }

  // Size = verdict band, capped by both the per-trade risk % and max position.
  const byVerdict = i.balanceSol * basePct;
  const byRisk = i.balanceSol * (i.riskPerTradePct / 100);
  let sizeSol = Math.min(byVerdict, byRisk, i.maxPositionSol);

  if (sizeSol <= 0) return { buy: false, sizeSol: 0, reasons: ["computed size is zero"] };
  if (sizeSol > i.balanceSol) sizeSol = i.balanceSol;
  if (sizeSol <= 0) return { buy: false, sizeSol: 0, reasons: ["insufficient sim balance"] };

  reasons.push(`${i.verdict}: ${((sizeSol / i.balanceSol) * 100).toFixed(1)}% of sim wallet`);
  return { buy: true, sizeSol, reasons };
}
