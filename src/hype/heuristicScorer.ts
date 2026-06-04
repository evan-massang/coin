import type { HypeResult } from "../types.js";
import { detectRevival } from "../engine/revivalScanner.js";

// Always-on, free narrative scorer (§1.7). Metadata completeness + keyword match
// against the live narrative buckets + revival detection. Pure.

export interface NarrativeBucket {
  tag: string;
  keywords: string[];
}

export interface HypeToken {
  name?: string;
  symbol?: string;
  description?: string;
}

export function computeHeuristicHype(
  token: HypeToken,
  narratives: NarrativeBucket[],
  knownMemes: string[],
): HypeResult {
  const text = [token.name, token.symbol, token.description].filter(Boolean).join(" ").toLowerCase();
  const tags: string[] = [];
  for (const bucket of narratives) {
    if (bucket.keywords.some((k) => text.includes(k.toLowerCase()))) tags.push(bucket.tag);
  }

  const revival = detectRevival(text, knownMemes);
  const hasNameSymbol = !!token.name?.trim() && !!token.symbol?.trim();

  let score = 38;
  score += Math.min(tags.length * 12, 36);
  if (revival.isRevival) score += 18;
  if (hasNameSymbol) score += 6;
  score = Math.max(0, Math.min(100, score));

  const bits: string[] = [];
  if (tags.length) bits.push(`narrative: ${tags.join(", ")}`);
  if (revival.isRevival) bits.push(`revival of "${revival.match}"`);
  if (!bits.length) bits.push("no strong narrative match");

  return {
    score,
    isRevival: revival.isRevival,
    source: "heuristic",
    rationale: bits.join("; "),
    tags,
  };
}
