import { type AttentionEvidence, clamp } from "./types.js";

// Phase 7 — Cultural Strength Intelligence. "WHY do people care?" Memes spread on
// emotional hooks — humor, nostalgia, cuteness, absurdity, tribal identity,
// relatability. A coin with a real cultural hook survives without traders; one
// without is pure ponzi mechanics. Heuristic now; the LLM judge deepens it. PURE.

const HOOKS: { tag: string; re: RegExp }[] = [
  { tag: "humor", re: /\b(lol|lmao|lmfao|funny|joke|hilarious|comedy|haha+)\b|😂|🤣/i },
  { tag: "nostalgia", re: /\b(remember|childhood|classic|throwback|nostalg\w*|\bog\b|2000s|90s|retro)\b/i },
  { tag: "cuteness", re: /\b(cute|adorable|wholesome|baby|puppy|kitten|precious)\b|🥺|❤️|🐶|🐱/i },
  { tag: "absurdity", re: /\b(wtf|random|weird|chaos|chaotic|unhinged|cursed|brainrot)\b/i },
  { tag: "identity", re: /\b(we|us|family|fam|community|gang|army|squad|together|brotherhood)\b/i },
  { tag: "relatable", re: /\b(so true|relatable|me when|big mood|literally me|fr fr|real)\b/i },
  { tag: "shock", re: /\b(insane|crazy|unbelievable|no way|shocking|wild)\b/i },
];

export interface CulturalStrengthResult {
  score: number; // 0..100
  tags: string[];
  reasons: string[];
}

export function computeCulturalStrength(ev: AttentionEvidence): CulturalStrengthResult {
  const text = ev.posts.map((p) => p.text).join("  \n  ") + " " + (ev.name ?? "") + " " + (ev.symbol ?? "");
  const tags = HOOKS.filter((h) => h.re.test(text)).map((h) => h.tag);

  let score = 35 + Math.min(45, tags.length * 13);

  // Emotional engagement (reactions) is evidence people actually feel something.
  const reactions = ev.posts.reduce((s, p) => s + (p.reactions ?? 0), 0);
  if (reactions > 0) score += Math.min(15, Math.log10(1 + reactions) * 6);

  const reasons = tags.length
    ? [`cultural hooks: ${tags.join(", ")}`]
    : ["no strong cultural hook detected — likely trade-driven only"];

  return { score: clamp(score), tags, reasons };
}
