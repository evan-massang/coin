import type { CouncilRole } from "../council/roles.js";
import { ROLE_PROMPT } from "../council/roles.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared council core — identical prompt-shaping + parsing for EVERY seat,
// whichever provider runs it (Anthropic directly, or any model via OpenCode).
// The council sees ONLY pre-digested evidence (counts/flags/scores the engine
// already produced), never raw chain data and never live price. It is advisory:
// it cannot trade, move funds, change a score, or override the Safety Gate.
// ─────────────────────────────────────────────────────────────────────────────

export interface CouncilVerdict {
  /** 0-100, higher = more favourable (for the risk seat: higher = safer). */
  score: number;
  recommendation: "confirm" | "caution";
  rationale: string;
}

export interface CouncilMemberResult extends CouncilVerdict {
  id: string;
  label: string;
  role: CouncilRole;
  model?: string;
  /** What this seat was asked to do (its role instruction) — shown in the room. */
  ask?: string;
  /** Round-trip latency for this seat, ms. */
  ms: number;
}

/** One line in the Council Room chat — an analyst "speaking". */
export interface CouncilMessage {
  /** 1 = opening take, 2 = debate / rebuttal. */
  round: number;
  id: string;
  label: string;
  role: CouncilRole;
  model?: string;
  text: string;
  recommendation?: "confirm" | "caution";
  score?: number;
  at: number;
}

const DEBATE_SYSTEM = `You are one analyst on a PANEL reviewing a Solana meme-coin for a READ-ONLY signal engine.
You see ONLY pre-digested evidence — never raw chain data, never live price. You are advisory only: you cannot trade, move funds, change a score, or override the Safety Gate.
Speak in 1-2 short sentences, like one message in a group chat — be specific and react to the other analysts. Do NOT output JSON. End with EXACTLY one final line:
CALL: confirm|caution SCORE: <0-100>`;

/** System prompt for the debate round — conversational, ends with CALL/SCORE. */
export function buildDebateSystemPrompt(role: CouncilRole): string {
  return `${DEBATE_SYSTEM}\n\n${ROLE_PROMPT[role]}`;
}

/** Round-2 debate prompt: react to the panel's opening takes from your seat. */
export function buildDebatePrompt(evidence: CouncilEvidence, others: CouncilMemberResult[]): string {
  const panel = others.map((o) => `- ${o.label} (${o.role}): ${o.recommendation.toUpperCase()} ${o.score} — ${o.rationale}`).join("\n");
  return `The panel gave opening takes on $${evidence.symbol ?? "?"}:\n${panel}\n\nFrom YOUR seat, respond to the panel in 1-2 sentences — hold your view, adjust, or push back, and say why. Then end with the CALL line.`;
}

/** Pull the spoken text + the final CALL/SCORE from a debate reply (robust to JSON). */
export function parseDebate(text: string): { text: string; recommendation: "confirm" | "caution"; score: number } {
  const callMatch = /CALL:\s*(confirm|caution)/i.exec(text);
  const scoreMatch = /SCORE:\s*(\d{1,3})/i.exec(text);
  if (callMatch || scoreMatch) {
    const spoken = text.replace(/CALL:[\s\S]*$/i, "").trim() || text.trim();
    return {
      text: spoken.slice(0, 400),
      recommendation: callMatch && /confirm/i.test(callMatch[1]!) ? "confirm" : "caution",
      score: scoreMatch ? Math.max(0, Math.min(100, parseInt(scoreMatch[1]!, 10))) : 50,
    };
  }
  // Model replied with JSON / prose instead — reuse the verdict parser, keep prose as the chat text.
  const v = parseVerdict(text);
  const spoken = text.replace(/```\w*|```/g, "").replace(/\{[\s\S]*\}\s*$/, "").trim();
  return { text: (spoken || (v ? v.rationale : text)).slice(0, 400), recommendation: v ? v.recommendation : "caution", score: v ? v.score : 50 };
}

/**
 * Evidence-only input. Deliberately NO raw holders/liquidity numbers — the
 * council reasons over the engine's *interpreted* signals (Graph Intelligence,
 * Evidence, Confidence, Risk), not blockchain primitives (Phase 4).
 */
export interface CouncilEvidence {
  symbol?: string;
  state?: string;
  coverage?: number;
  convictionTier?: string;
  bullCount: number;
  bearCount: number;
  bullPoints: string[];
  bearPoints: string[];
  clusterDetected: boolean;
  smartMoney: boolean;
  devSold: boolean;
  rugMatch: boolean;
  marketRegime?: string;
  similarWinners?: number;
}

const BASE_SYSTEM = `You are one analyst on a PANEL reviewing a Solana meme-coin for a READ-ONLY signal engine.
You see ONLY pre-digested evidence (counts, flags, interpreted scores) — never raw chain data and never live price to chase.
You are advisory ONLY: you cannot place trades, move funds, change any score, or override the engine's Safety Gate or Risk Engine.
Rate honestly from your seat: if the evidence is thin or bearish, say so even from a bullish seat. Do not call any tools.

Respond with STRICT JSON ONLY, nothing else:
{"score": <0-100 integer, higher = more favourable from your seat>, "recommendation": "confirm" | "caution", "rationale": "<one sentence, <=140 chars>"}`;

/** Full system prompt for a seat = shared base + the role's perspective. */
export function buildSystemPrompt(role: CouncilRole): string {
  return `${BASE_SYSTEM}\n\n${ROLE_PROMPT[role]}`;
}

/** Render the evidence-only payload into the user message (no raw chain data). */
export function buildEvidencePrompt(e: CouncilEvidence): string {
  const lines = [
    `token: $${e.symbol ?? "?"}`,
    `observation_state: ${e.state ?? "unknown"} (data coverage ${e.coverage ?? "?"}%)`,
    `engine_conviction_tier: ${e.convictionTier ?? "?"}`,
    `bull_evidence_count: ${e.bullCount}`,
    `bear_evidence_count: ${e.bearCount}`,
    `bull_points: ${e.bullPoints.length ? e.bullPoints.join("; ") : "none"}`,
    `bear_points: ${e.bearPoints.length ? e.bearPoints.join("; ") : "none"}`,
    `smart_money_present: ${e.smartMoney}`,
    `buyer_cluster_detected: ${e.clusterDetected}`,
    `deployer_sold: ${e.devSold}`,
    `matches_known_rug: ${e.rugMatch}`,
    `similar_past_winners: ${e.similarWinners ?? 0}`,
    `market_regime: ${e.marketRegime ?? "unknown"}`,
  ];
  return lines.join("\n");
}

/** Defensive JSON extraction shared by every provider. Never throws. */
export function parseVerdict(text: string): CouncilVerdict | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let raw: { score?: unknown; recommendation?: unknown; rationale?: unknown };
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? Math.max(0, Math.min(100, Math.round(raw.score))) : 50;
  return {
    score,
    recommendation: raw.recommendation === "confirm" ? "confirm" : "caution",
    rationale: typeof raw.rationale === "string" && raw.rationale.trim() ? raw.rationale.slice(0, 200) : "no rationale",
  };
}
