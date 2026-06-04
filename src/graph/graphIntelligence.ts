import type {
  ConvictionTier, EvidenceItem, GraphEntity, GraphIntel, ObservationState, SafetyResult, ScoreBreakdown, TimelineEvent, Verdict,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Graph Intelligence Layer (Observation → Confidence → Graph → Evidence). Turns
// a token's observed data into the operator question: *why* does the engine
// believe — or doubt — this token? Produces an entity graph, bull/bear evidence,
// coverage, observation state, a "why" explanation, and a timeline. Pure.
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphIntelInput {
  mint: string;
  symbol?: string;
  creator?: string;
  scores: ScoreBreakdown;
  safety: SafetyResult;
  verdict: Verdict;
  conviction: number;
  devSold?: boolean;
  bundle?: boolean;
  rugMatch?: boolean;
  similarWinners?: number;
  deployerLaunches?: number;
  liquidityUsd?: number;
  tradeCount: number;
  firstSeenAt: number;
  now: number;
}

function tier(conviction: number): ConvictionTier {
  return conviction >= 72 ? "HIGH" : conviction >= 50 ? "MEDIUM" : "LOW";
}

function observationState(i: GraphIntelInput, coverage: number): ObservationState {
  if (!i.safety.pass) return "ARCHIVED";
  if (i.verdict === "AVOID" || i.verdict === "TOO_LATE") return "ARCHIVED";
  if (i.verdict === "BUY_SMALL" || i.verdict === "BUY_STRONG") return "DECISION_READY";
  return coverage >= 60 ? "MATURE" : "OBSERVING";
}

function computeCoverage(i: GraphIntelInput, rugcheckLoaded: boolean): number {
  const dims = [
    rugcheckLoaded, // safety / authorities
    i.liquidityUsd !== undefined, // liquidity
    i.tradeCount > 0, // trade flow
    i.tradeCount >= 8, // momentum sample
    i.scores.hype > 0, // narrative
  ];
  return Math.round((dims.filter(Boolean).length / dims.length) * 100);
}

function buildEntities(i: GraphIntelInput): GraphEntity[] {
  const s = i.scores;
  const e: GraphEntity[] = [{ id: i.mint, type: "TOKEN", label: "$" + (i.symbol || i.mint.slice(0, 5)), sub: i.verdict }];
  e.push({ id: "dev", type: "DEV", label: "DEV WALLET", sub: i.devSold ? "sold" : "holding" });
  e.push({ id: "buyers", type: "BUYERS", label: "ORGANIC BUYERS", sub: `${Math.round(s.organic)}% organic` });
  if (i.tradeCount >= 12) e.push({ id: "cluster", type: "CLUSTER", label: "BUYER CLUSTER", sub: `${i.tradeCount} trades` });
  if (s.smartMoney >= 55) e.push({ id: "smart", type: "SMART_MONEY", label: "SMART MONEY", sub: "tracked" });
  if (s.hype >= 50) e.push({ id: "narrative", type: "NARRATIVE", label: "NARRATIVE", sub: "trending" });
  if (i.bundle) e.push({ id: "bundle", type: "KNOWN_RUG", label: "BUNDLE / SNIPER", sub: "detected" });
  if (i.rugMatch) e.push({ id: "rug", type: "KNOWN_RUG", label: "KNOWN RUG", sub: "fingerprint match" });
  if (i.safety.unknownCount >= 2) e.push({ id: "unv", type: "UNVERIFIED", label: "UNVERIFIED", sub: "unknowns" });
  return e;
}

function buildEvidence(i: GraphIntelInput): { bull: EvidenceItem[]; bear: EvidenceItem[] } {
  const s = i.scores;
  const bull: EvidenceItem[] = [];
  const bear: EvidenceItem[] = [];

  if (s.safety >= 70) bull.push({ label: "RugCheck safety clean", weight: 15 });
  if (s.organic >= 60) bull.push({ label: "Organic buying", weight: 12 });
  else if (s.organic >= 50) bull.push({ label: "Organic flow holding", weight: 7 });
  if (s.momentum >= 60) bull.push({ label: "Buyer velocity rising", weight: 12 });
  if (s.smartMoney >= 55) bull.push({ label: "Smart wallet cluster entered", weight: 14 });
  if (s.graduation >= 50) bull.push({ label: "Bonding curve filling", weight: 8 });
  if (i.liquidityUsd !== undefined && i.liquidityUsd >= 3000) bull.push({ label: "Liquidity holding", weight: 8 });
  if (s.hype >= 60) bull.push({ label: "Strong narrative", weight: 8 });
  if ((i.similarWinners ?? 0) > 0) bull.push({ label: `Similar to ${i.similarWinners} historical winner(s)`, weight: 10 });
  if (i.safety.pass && !i.rugMatch && !i.bundle) bull.push({ label: "No rug pattern detected", weight: 6 });

  if (i.devSold) bear.push({ label: "Deployer wallet sold", weight: 18 });
  if (i.bundle) bear.push({ label: "Bundle / sniper cluster", weight: 16 });
  if (i.rugMatch) bear.push({ label: "Matches a known rug", weight: 20 });
  if (s.organic < 45) bear.push({ label: "Wash / low organic volume", weight: 14 });
  if (s.lateEntryRisk >= 50) bear.push({ label: "Late entry — price already ran", weight: 10 });
  if (i.liquidityUsd !== undefined && i.liquidityUsd < 3000) bear.push({ label: "Thin liquidity", weight: 8 });
  if (s.hype < 40) bear.push({ label: "Weak narrative", weight: 5 });
  if (i.safety.unknownCount >= 2) bear.push({ label: "Unverified data", weight: 6 });
  if ((i.deployerLaunches ?? 0) <= 1 && i.creator) bear.push({ label: "New deployer (no history)", weight: 4 });

  return { bull, bear };
}

function buildTimeline(i: GraphIntelInput, state: ObservationState): TimelineEvent[] {
  const age = Math.max(i.now - i.firstSeenAt, 0);
  const at = (frac: number) => Math.round(age * frac);
  const t: TimelineEvent[] = [{ atMs: 0, label: "Discovered" }];
  if (i.liquidityUsd !== undefined) t.push({ atMs: at(0.2), label: "Liquidity confirmed" });
  if (i.scores.smartMoney >= 55) t.push({ atMs: at(0.35), label: "Smart wallet entry" });
  if (i.tradeCount >= 12) t.push({ atMs: at(0.5), label: "Buyer cluster forming" });
  if (i.scores.hype >= 50) t.push({ atMs: at(0.65), label: "Narrative growth" });
  if (i.devSold) t.push({ atMs: at(0.7), label: "⚠ Dev wallet sold" });
  t.push({ atMs: age, label: state === "DECISION_READY" ? "Decision ready" : state === "ARCHIVED" ? "Archived" : "Observing" });
  return t.sort((a, b) => a.atMs - b.atMs);
}

function buildWhy(bull: EvidenceItem[], bear: EvidenceItem[], i: GraphIntelInput): string[] {
  const sorted = [...bull].sort((a, b) => b.weight - a.weight);
  if (sorted.length === 0) {
    const topBear = [...bear].sort((a, b) => b.weight - a.weight)[0];
    return [`No bullish evidence — ${topBear ? topBear.label.toLowerCase() : "thin data"}`];
  }
  const why = sorted.slice(0, 5).map((e) => e.label);
  if ((i.similarWinners ?? 0) > 0 && !why.some((w) => w.includes("historical"))) why.push(`Similar to ${i.similarWinners} historical winner(s)`);
  return why;
}

export function computeGraphIntelligence(i: GraphIntelInput): GraphIntel {
  const rugcheckLoaded = i.liquidityUsd !== undefined || i.safety.checks.some((c) => c.id === "rugcheckRisk" && c.status !== "UNKNOWN");
  const coverage = computeCoverage(i, rugcheckLoaded);
  const state = observationState(i, coverage);
  const { bull, bear } = buildEvidence(i);
  const bullScore = bull.reduce((a, e) => a + e.weight, 0);
  const bearScore = bear.reduce((a, e) => a + e.weight, 0);
  return {
    mint: i.mint,
    symbol: i.symbol,
    state,
    coverage,
    confidence: Math.round(i.conviction),
    convictionTier: tier(i.conviction),
    observationAgeMs: Math.max(i.now - i.firstSeenAt, 0),
    entities: buildEntities(i),
    bull,
    bear,
    bullScore,
    bearScore,
    why: buildWhy(bull, bear, i),
    timeline: buildTimeline(i, state),
    at: i.now,
  };
}
