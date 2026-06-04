// ─────────────────────────────────────────────────────────────────────────────
// Shared domain types — the contract every module builds on.
//
// Design rule: scoring is GATE → SCORE → CAP → VERDICT. Safety is a hard gate,
// never a weight. AI narrative (`hype`) is confirmation only and can never
// override safety or force a BUY. This file encodes those shapes.
// ─────────────────────────────────────────────────────────────────────────────

/** The full verdict set. TOO_LATE matters most for manual desktop trading. */
export type Verdict =
  | "AVOID"
  | "WATCH_ONLY"
  | "BUY_SMALL"
  | "BUY_STRONG"
  | "TOO_LATE"
  | "SELL_TRIM"
  | "SELL_EXIT_NOW";

/** Verdicts that should fire a desktop notification + sound (the rest stay quiet). */
export const LOUD_VERDICTS: ReadonlySet<Verdict> = new Set<Verdict>([
  "BUY_SMALL",
  "BUY_STRONG",
  "SELL_TRIM",
  "SELL_EXIT_NOW",
]);

// ── Discovery feed ───────────────────────────────────────────────────────────

/** A freshly-created token observed on pump.fun (PumpPortal `create` event). */
export interface NewToken {
  mint: string;
  name?: string;
  symbol?: string;
  creator?: string;
  uri?: string;
  /** Initial SOL in the bonding curve, if reported. */
  initialBuySol?: number;
  /** Market cap in SOL at creation, if reported. */
  marketCapSol?: number;
  pool?: string;
  seenAt: number;
}

/** A single on-chain trade event (token trade stream or wallet trade stream). */
export interface TradeEvent {
  mint: string;
  /** Trader public key. */
  trader: string;
  side: "buy" | "sell";
  solAmount?: number;
  tokenAmount?: number;
  marketCapSol?: number;
  signature?: string;
  /** ms epoch when observed. */
  at: number;
}

/** Back-compat alias used by the copy/wallet tracker. */
export type WalletTrade = TradeEvent;

// ── Market snapshot ──────────────────────────────────────────────────────────

/** Point-in-time market data for a mint, assembled from sources. */
export interface MarketSnapshot {
  mint: string;
  priceUsd?: number;
  priceSol?: number;
  liquidityUsd?: number;
  marketCapUsd?: number;
  marketCapSol?: number;
  /** Bonding-curve fill toward graduation (~$69k → PumpSwap). 0..1. */
  bondingCurveProgress?: number;
  volume?: { m5?: number; h1?: number; h24?: number };
  at: number;
}

// ── Safety gate (§1.2) ───────────────────────────────────────────────────────

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface SafetyCheck {
  /** Stable id, e.g. "mintAuthority", "freezeAuthority", "topHolderPct". */
  id: string;
  status: CheckStatus;
  /** A FAIL on a fatal check forces AVOID regardless of every other signal. */
  fatal: boolean;
  label: string;
  detail?: string;
}

export interface SafetyResult {
  /** false ⇒ hard AVOID. */
  pass: boolean;
  /** 0 = sub-second hard kill; 1 = post-observation promotion gate. */
  stage: 0 | 1;
  checks: SafetyCheck[];
  /** Number of UNKNOWN checks — drives a conviction cap (§1.6). */
  unknownCount: number;
  /** Reasons a fatal check failed (for the alert + journal). */
  fatalReasons: string[];
  /** 0 (toxic) .. 100 (clean) — informational; the gate is `pass`, not this. */
  score: number;
}

// ── Sub-scores + decision (§1.6) ─────────────────────────────────────────────

/**
 * All sub-scores on a 0..100 scale, EXCEPT lateEntryRisk which is a RISK
 * (higher = worse). Priority order is encoded in the scoring pipeline, not here.
 */
export interface ScoreBreakdown {
  safety: number;
  organic: number;
  momentum: number;
  graduation: number;
  devReputation: number;
  smartMoney: number;
  social: number;
  /** AI narrative — confirmation only. */
  hype: number;
  /** Higher = later/worse entry. >threshold ⇒ TOO_LATE. */
  lateEntryRisk: number;
}

export function emptyScores(): ScoreBreakdown {
  return {
    safety: 0,
    organic: 0,
    momentum: 0,
    graduation: 0,
    devReputation: 0,
    smartMoney: 0,
    social: 0,
    hype: 0,
    lateEntryRisk: 0,
  };
}

/** Output of the scoring pipeline for one mint at one instant. */
export interface Decision {
  mint: string;
  symbol?: string;
  name?: string;
  verdict: Verdict;
  /** 0..100 final conviction AFTER caps applied. */
  conviction: number;
  scores: ScoreBreakdown;
  reasons: string[];
  /** Danger flags surfaced to the UI (e.g. "dev holds 18%"). */
  flags: string[];
  /** Which caps fired, for transparency (e.g. "organic<45 ⇒ cap 49"). */
  caps: string[];
  // ── MicroFish risk sizing (advisory / paper-only; Phase 2) ──
  riskTier?: "NONE" | "TINY" | "LOW" | "MEDIUM" | "HIGH";
  suggestedRiskPct?: number;
  maxPositionSol?: number;
  marketWeather?: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
  sourceAgreement?: number;
  redFlags?: string[];
  at: number;
}

// ── Alerts (§Part 4 Tab 1, dispatcher) ───────────────────────────────────────

export interface AlertLinks {
  phantom: string;
  jupiter: string;
  dexscreener: string;
  rugcheck: string;
}

export interface Alert {
  kind: Verdict;
  mint: string;
  symbol?: string;
  name?: string;
  conviction: number;
  scores: ScoreBreakdown;
  reasons: string[];
  flags: string[];
  links: AlertLinks;
  riskTier?: "NONE" | "TINY" | "LOW" | "MEDIUM" | "HIGH";
  suggestedRiskPct?: number;
  maxPositionSol?: number;
  marketWeather?: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
  sourceAgreement?: number;
  redFlags?: string[];
  at: number;
}

// ── Positions + exits (§1.8, Part 2) ─────────────────────────────────────────

export type PositionStatus = "OPEN" | "PARTIAL" | "CLOSED";

/** Where a position came from: a real observed wallet, or the paper sim wallet. */
export type PositionSource = "wallet" | "paper";

export interface LadderRung {
  /** Trigger multiple on entry price, e.g. 2 = 2x. */
  multiple: number;
  /** Fraction (0..1) of the INITIAL position to sell when hit. */
  sellPct: number;
  done: boolean;
}

export interface ExitPlan {
  ladder: LadderRung[];
  /** Volatility-aware trailing stop, as a fraction drop from peak (0..1). */
  trailingStopPct: number;
  /** Time stop in ms (MAX_HOLD). */
  maxHoldMs: number;
}

export interface Position {
  id: number;
  mint: string;
  symbol?: string;
  source: PositionSource;
  status: PositionStatus;
  entryPriceUsd: number;
  entryAtMs: number;
  /** Current token holding (decreases as the ladder sells). */
  tokenAmount: number;
  initialTokenAmount: number;
  /** SOL invested (paper) / inferred cost basis (wallet). */
  solInvested: number;
  costBasisUsd: number;
  realizedPnlUsd: number;
  /** Highest price seen since entry — drives the trailing stop. */
  peakPriceUsd: number;
  lastPriceUsd?: number;
  exitPlan: ExitPlan;
  closedAtMs?: number;
}

export type ExitSignalKind = "HOLD" | "SELL_TRIM" | "SELL_EXIT_NOW";

export interface ExitSignal {
  mint: string;
  kind: ExitSignalKind;
  /** Fraction (0..1) of CURRENT holdings to sell. 1 = exit fully. */
  sellPct: number;
  reason: string;
  /** Hard exit (rug/dev/top-holder/alpha-exit/distribution) beats ladder. */
  hard: boolean;
  at: number;
}

// ── Wallet observer (Part 2) ─────────────────────────────────────────────────

export interface ObservedHolding {
  mint: string;
  /** Raw token amount currently held (UI units). */
  amount: number;
  decimals: number;
}

export interface WalletStatus {
  address: string;
  connected: boolean;
  lastCheckedMs?: number;
  error?: string;
}

// ── Copy trading (§1.9) ──────────────────────────────────────────────────────

export interface WalletScore {
  address: string;
  pnl30dSol: number;
  pnl90dSol: number;
  twoXHitRate: number;
  avgHoldMs: number;
  rugExposureRate: number;
  earlyEntryScore: number;
  exitsBeforeFollowers: boolean;
  /** 0..100 composite; below threshold ⇒ don't copy. */
  score: number;
  /** Don't-copy reasons, if any. */
  blockReasons: string[];
}

// ── AI hype (§1.7) ───────────────────────────────────────────────────────────

export interface HypeResult {
  /** 0..100 narrative strength. */
  score: number;
  isRevival: boolean;
  /** "heuristic" (always free) or "llm" (optional, user key). */
  source: "heuristic" | "llm";
  rationale: string;
  /** Matched narrative tags from data/narratives.json. */
  tags: string[];
}

// ── Learning + backtest (§1.12–1.13) ─────────────────────────────────────────

export type FeatureSource = "signal" | "paper" | "wallet";

export interface FeatureRecord {
  id?: number;
  mint: string;
  at: number;
  verdict: Verdict;
  scores: ScoreBreakdown;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  maxGainPct?: number;
  maxDrawdownPct?: number;
  holdMs?: number;
  exitReason?: string;
  realizedPnlSol?: number;
  source: FeatureSource;
}

export type SuggestionStatus = "pending" | "applied" | "ignored";

export interface Suggestion {
  id?: number;
  at: number;
  /** e.g. "raise_min_organic". */
  kind: string;
  /** Settings key the suggestion targets. */
  setting: string;
  from: number;
  to: number;
  rationale: string;
  status: SuggestionStatus;
}

export interface BacktestRun {
  id?: number;
  at: number;
  /** Alternative settings under test (only the overridden keys). */
  settings: Record<string, number>;
  trades: number;
  winRate: number;
  totalPnlSol: number;
  maxDrawdownPct: number;
  bestTradePct: number;
  worstTradePct: number;
  avgHoldMs: number;
}

export interface SettingChange {
  id?: number;
  at: number;
  setting: string;
  from: number | string;
  to: number | string;
  /** "user" (manual apply) or "auto" (bounded auto-tune). */
  by: "user" | "auto";
  note?: string;
}
