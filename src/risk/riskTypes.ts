import type { ScoreBreakdown, Verdict } from "../types.js";

// MiroFish dynamic risk sizing (§Phase 2). Turns a verdict + the score/safety
// facts into a *recommended* position size — paper-only / advisory, NEVER a
// real-wallet trade. Pure.

export type RiskTier = "NONE" | "TINY" | "LOW" | "MEDIUM" | "HIGH";

export interface RiskMultipliers {
  safety: number;
  liquidity: number;
  organic: number;
  momentum: number;
  marketWeather: number;
  sourceAgreement: number;
  volatility: number;
  timeDecay: number;
}

export interface RiskContext {
  verdict: Verdict;
  conviction: number;
  scores: ScoreBreakdown;
  safetyPass: boolean;
  unknownCount: number;
  honeypot?: boolean;
  liquidityUsd?: number;
  minLiquidityUsd: number;
  /** From Phase 4 agents; default 1 when absent. */
  marketWeatherMultiplier?: number;
  sourceAgreementMultiplier?: number;
  /** From Phase 5 scam memory (deployer × similarity × cluster); default 1. */
  scamMemoryMultiplier?: number;
  /** Tuning. */
  baseRiskPct: number;
  maxRiskPct: number;
  minRiskPct: number;
  maxPositionSol: number;
}

export interface RiskDecision {
  verdict: Verdict;
  conviction: number;
  riskTier: RiskTier;
  /** % of (paper) wallet to risk. 0 ⇒ no buy. */
  suggestedRiskPct: number;
  maxPositionSol: number;
  multipliers: RiskMultipliers;
  reasons: string[];
}
