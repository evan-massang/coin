import { type AttentionEvidence, type AttentionScores, clamp, clamp01 } from "./types.js";
import { computeHumanity } from "./humanityAgent.js";
import { computeVirality } from "./viralityAgent.js";
import { computeOutsideCrypto } from "./outsideCryptoAgent.js";
import { computeCulturalStrength } from "./culturalStrengthAgent.js";

// Phase 18 — the Attention pillar. Combines the four attention agents into one
// composite + a confidence (how much evidence backs it) + a narrative. This is
// the heuristic baseline; the local-LLM judge (Phase 8) can override/augment the
// individual scores with deeper reasoning, but the composite math stays here so
// the engine always has a deterministic attention read even with no LLM.

/** Composite weights — humanity dominates (fake attention is the #1 trap). */
export const ATTENTION_WEIGHTS = { humanity: 0.35, virality: 0.25, outsideCrypto: 0.2, culturalStrength: 0.2 } as const;

export function computeAttention(ev: AttentionEvidence, now: number = ev.fetchedAt): AttentionScores {
  const h = computeHumanity(ev.posts);
  const v = computeVirality(ev, now);
  const o = computeOutsideCrypto(ev);
  const c = computeCulturalStrength(ev);

  const platforms = new Set(ev.posts.map((p) => p.platform).filter(Boolean)).size;
  // Confidence: more posts + more platforms = more trustworthy read.
  const confidence = clamp01((Math.min(ev.posts.length, 30) / 30) * 0.6 + (Math.min(platforms, 4) / 4) * 0.4);

  const attention = clamp(
    h.score * ATTENTION_WEIGHTS.humanity +
      v.score * ATTENTION_WEIGHTS.virality +
      o.score * ATTENTION_WEIGHTS.outsideCrypto +
      c.score * ATTENTION_WEIGHTS.culturalStrength,
  );

  const reasons = [
    ...h.reasons.slice(0, 1),
    ...v.reasons.slice(0, 1),
    ...o.reasons.slice(0, 1),
    ...c.reasons.slice(0, 1),
  ];

  const narrative =
    `attention ${Math.round(attention)} — humanity ${Math.round(h.score)}, virality ${Math.round(v.score)}, ` +
    `outside-crypto ${Math.round(o.score)}, culture ${Math.round(c.score)} (conf ${Math.round(confidence * 100)}%)`;

  return {
    humanity: h.score,
    virality: v.score,
    outsideCrypto: o.score,
    culturalStrength: c.score,
    attention,
    confidence,
    tags: c.tags,
    narrative,
    reasons,
  };
}
