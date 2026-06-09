import type { SignalRecord } from "../store/repositories/signalsRepo.js";
import type { CouncilOpinionRow } from "../store/repositories/councilRepo.js";
import type { PaperFill } from "../store/repositories/paperRepo.js";
import type { MissionRow } from "../store/repositories/missionRepo.js";
import type { AttentionRecord } from "../attention/attentionService.js";
import type { GraphIntel } from "../types.js";

// Project Hermes Phase 9/17 — the research CASE FILE: one per-coin record that
// glues together everything the engine knows, so a recommendation can be replayed
// end-to-end (discovery → decision evolution → research → council → trades →
// missions → outcome). Built PURELY at query time by joining existing per-mint
// tables — no new schema, no execution path, read-only.

export interface CaseFileInput {
  mint: string;
  /** Signal journal for the mint, OLDEST→newest (signalsRepo.forMint order). */
  signals: SignalRecord[];
  council: CouncilOpinionRow[];
  fills: PaperFill[];
  missions: MissionRow[];
  attention?: AttentionRecord;
  intel?: GraphIntel;
  now: number;
}

export interface CaseFile {
  mint: string;
  symbol?: string;
  current: { verdict: string; conviction: number; at: number } | null;
  /** Verdict/conviction evolution oldest→newest (WATCH→BUY journey, re-scores, exits). */
  timeline: Array<{ at: number; verdict: string; conviction: number; reasons: string[]; caps: string[] }>;
  research: { attention: number; confidence: number; source: string; narrative: string } | null;
  council: { sessions: number; opinions: number; confirms: number; cautions: number; avgScore: number; resolved: number; wins: number };
  trades: { buys: number; sells: number; realizedPnlSol: number; lastReason?: string };
  missions: Array<{ id: number; status: string; verdict: string; conviction: number; gaps: string[]; recommendation?: string; provider?: string; createdAt: number }>;
  /** Entry thesis (Phase 11): the rationale captured at the FIRST BUY — null if never bought. */
  thesis: { at: number; verdict: string; conviction: number; attentionAtEntry: number; keyReasons: string[] } | null;
  /** Advisory, READ-ONLY thesis-decay read (Phase 13): entry vs current attention.
   *  Never triggers a sell — surfaced to the operator only. Null with no thesis/research. */
  thesisHealth: { entry: number; current: number; delta: number; status: "intact" | "weakening" | "broken" } | null;
  outcome: { maxGainPct?: number; maxDrawdownPct?: number; resolved: boolean };
  generatedAt: number;
}

export function buildCaseFile(i: CaseFileInput): CaseFile {
  const signals = i.signals;
  const latest = signals.length ? signals[signals.length - 1]! : null;
  const symbol = latest?.symbol ?? i.attention?.evidence.symbol;

  const timeline = signals.map((s) => ({
    at: s.at,
    verdict: s.verdict,
    conviction: s.conviction,
    reasons: s.reasons.slice(0, 3),
    caps: s.caps,
  }));

  const research = i.attention
    ? {
        attention: Math.round(i.attention.scores.attention),
        confidence: i.attention.scores.confidence,
        source: i.attention.source,
        narrative: i.attention.scores.narrative,
      }
    : null;

  const sessions = new Set(i.council.map((o) => o.at)).size;
  const council = {
    sessions,
    opinions: i.council.length,
    confirms: i.council.filter((o) => o.recommendation === "confirm").length,
    cautions: i.council.filter((o) => o.recommendation === "caution").length,
    avgScore: i.council.length ? Math.round(i.council.reduce((a, o) => a + o.score, 0) / i.council.length) : 0,
    resolved: i.council.filter((o) => o.outcome).length,
    wins: i.council.filter((o) => o.outcome === "win").length,
  };

  const trades = {
    buys: i.fills.filter((f) => f.side === "buy").length,
    sells: i.fills.filter((f) => f.side === "sell").length,
    realizedPnlSol: round(i.fills.reduce((a, f) => a + f.realizedPnlSol, 0), 4),
    lastReason: i.fills[0]?.reason, // fills are newest-first
  };

  const missions = i.missions.map((m) => ({
    id: m.id,
    status: m.status,
    verdict: m.mission?.verdict ?? m.verdict ?? "?",
    conviction: m.mission?.conviction ?? m.conviction ?? 0,
    gaps: m.mission?.gaps ?? [],
    recommendation: m.result?.recommendation,
    provider: m.provider,
    createdAt: m.createdAt,
  }));

  // Entry thesis (Phase 11): the first BUY is the moment we committed; its score
  // snapshot + reasons ARE the recorded rationale. Derived from the journal — no
  // separate store. thesisHealth (Phase 13) compares it to the latest attention
  // read; it is ADVISORY + READ-ONLY and never acts on the position.
  const entry = signals.find((s) => s.verdict === "BUY_SMALL" || s.verdict === "BUY_STRONG") ?? null;
  const thesis = entry
    ? {
        at: entry.at,
        verdict: entry.verdict,
        conviction: entry.conviction,
        attentionAtEntry: Math.round(entry.scores.attention ?? 0),
        keyReasons: entry.reasons.slice(0, 3),
      }
    : null;
  const curAtt = i.attention ? Math.round(i.attention.scores.attention) : null;
  let thesisHealth: CaseFile["thesisHealth"] = null;
  if (thesis && curAtt != null) {
    const delta = curAtt - thesis.attentionAtEntry;
    thesisHealth = { entry: thesis.attentionAtEntry, current: curAtt, delta, status: delta <= -20 ? "broken" : delta < -8 ? "weakening" : "intact" };
  }

  const gains = signals.map((s) => s.maxGainPct).filter((x): x is number => x != null);
  const draws = signals.map((s) => s.maxDrawdownPct).filter((x): x is number => x != null);
  const outcome = {
    maxGainPct: gains.length ? Math.max(...gains) : undefined,
    maxDrawdownPct: draws.length ? Math.min(...draws) : undefined, // worst (most negative)
    resolved: gains.length > 0,
  };

  return {
    mint: i.mint,
    symbol,
    current: latest ? { verdict: latest.verdict, conviction: latest.conviction, at: latest.at } : null,
    timeline,
    research,
    council,
    trades,
    missions,
    thesis,
    thesisHealth,
    outcome,
    generatedAt: i.now,
  };
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
