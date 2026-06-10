import type { AttentionScores, AttentionEvidence } from "../attention/types.js";
import type { AttentionRecord } from "../attention/attentionService.js";
import type { MissionResult } from "../store/repositories/missionRepo.js";
import { clamp, clamp01 } from "../attention/types.js";

// Shared mapping: a mission recommendation (operator-pasted OR Manus-API) → the
// AttentionScores record that flows through AttentionService.injectResult →
// rescoreWithAttention → decide(). One implementation for both paths, so the
// advisory guarantee is identical regardless of who answered. All numeric inputs
// are CLAMPED to their domain (0..100 / 0..1) — a hostile or buggy payload like
// {attention: 1e9} must not leak absurd values into dashboards or the graveyard
// (conviction was already safe; displays were not).

/** Map a recommendation (+ optional explicit sub-scores) to clamped AttentionScores. */
export function resultToScores(result: MissionResult): AttentionScores {
  const recBase: Record<string, number> = { confirm: 78, caution: 45, unsure: 35, avoid: 12 };
  const base = recBase[result.recommendation] ?? 35;
  const sc = result.scores ?? {};
  const attention = clamp(num(sc.attention, base));
  return {
    humanity: clamp(num(sc.humanity, attention)),
    virality: clamp(num(sc.virality, attention)),
    outsideCrypto: clamp(num(sc.outsideCrypto, attention)),
    culturalStrength: clamp(num(sc.culturalStrength, attention)),
    attention,
    confidence: clamp01(num(result.confidence, 60) / 100),
    tags: [],
    narrative: str(result.narrative) ?? `Manus: ${result.recommendation} (confidence ${Math.round(clamp(num(result.confidence, 60)))})`,
    reasons: Array.isArray(result.reasons) ? result.reasons.map(String).slice(0, 8) : [`mission recommendation: ${result.recommendation}`],
  };
}

/** Wrap a mission result as a full AttentionRecord ready for injectResult. */
export function resultToRecord(mint: string, symbol: string | undefined, result: MissionResult, at: number): AttentionRecord {
  const evidence: AttentionEvidence = { mint, symbol, query: symbol ?? mint, posts: [], platforms: [], links: [], fetchedAt: at };
  return { mint, scores: resultToScores(result), evidence, at, source: result.provider ?? "manus" };
}

function num(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

function str(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() ? x : undefined;
}
