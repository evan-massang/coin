import { type AttentionPost, clamp, normalizeText } from "./types.js";

// Phase 4 — Humanity Intelligence. "Are REAL humans discussing this, or is it a
// bot farm / copy-paste shill campaign?" A first-class signal: meme value is
// human attention, and fake attention is the #1 way a meme coin looks alive but
// is hollow. PURE + deterministic.

export interface HumanityResult {
  score: number; // 0..100 (higher = more genuinely human)
  uniqueAuthorRatio: number; // distinct authors / posts-with-author
  duplicateRatio: number; // 1 − (unique normalized texts / posts)
  diversity: number; // unique normalized texts / posts
  maxAuthorShare: number; // largest single author's share of posts
  botPenalty: number;
  reasons: string[];
}

export function computeHumanity(posts: AttentionPost[]): HumanityResult {
  const n = posts.length;
  if (n < 3) {
    return { score: 50, uniqueAuthorRatio: 0, duplicateRatio: 0, diversity: 0, maxAuthorShare: 0, botPenalty: 0, reasons: ["insufficient chatter to judge humanity"] };
  }

  const authors = posts.map((p) => p.author).filter((a): a is string => !!a);
  const uniqueAuthors = new Set(authors).size;
  const uniqueAuthorRatio = authors.length ? uniqueAuthors / authors.length : 0;

  const norms = posts.map((p) => normalizeText(p.text)).filter((t) => t.length > 0);
  const uniqueNorms = new Set(norms).size;
  const diversity = norms.length ? uniqueNorms / norms.length : 0;
  const duplicateRatio = 1 - diversity;

  const counts: Record<string, number> = {};
  for (const a of authors) counts[a] = (counts[a] ?? 0) + 1;
  const maxAuthorShare = authors.length ? Math.max(0, ...Object.values(counts)) / authors.length : 0;

  const reasons: string[] = [];
  let botPenalty = 0;
  if (duplicateRatio >= 0.6) {
    botPenalty += 30;
    reasons.push(`copy-paste shilling: ${Math.round(duplicateRatio * 100)}% duplicate text`);
  } else if (duplicateRatio >= 0.4) {
    botPenalty += 15;
    reasons.push("templated/repetitive chatter");
  }
  if (maxAuthorShare >= 0.5) {
    botPenalty += 20;
    reasons.push("a single account dominates the conversation");
  }

  let score = 40;
  score += uniqueAuthorRatio * 35; // many distinct humans
  score += diversity * 25; // varied content (real people say different things)
  score -= botPenalty;

  if (botPenalty === 0 && uniqueAuthorRatio >= 0.7 && diversity >= 0.6) {
    reasons.unshift(`${uniqueAuthors} distinct authors, varied organic content`);
  }

  return { score: clamp(score), uniqueAuthorRatio, duplicateRatio, diversity, maxAuthorShare, botPenalty, reasons };
}
