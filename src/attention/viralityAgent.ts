import { type AttentionEvidence, clamp } from "./types.js";

// Phase 5 — Virality Intelligence. "Is attention accelerating / spreading?" True
// growth needs a time series (see the multi-pass re-research), but on a SINGLE
// pass we proxy spread by: platform breadth (cross-platform = contagious), raw
// volume, and recency (fresh posts = live, not stale). PURE.

export interface ViralityResult {
  score: number; // 0..100
  breadth: number; // distinct platforms with chatter
  volume: number; // total posts
  recentCount: number; // posts in the last 6h
  reasons: string[];
}

export function computeVirality(ev: AttentionEvidence, now: number): ViralityResult {
  const platforms = new Set<string>();
  for (const p of ev.posts) if (p.platform) platforms.add(p.platform);
  for (const pl of ev.platforms) if (pl) platforms.add(pl);

  const breadth = platforms.size;
  const volume = ev.posts.length;
  const recentCount = ev.posts.filter((p) => p.at && now - p.at < 6 * 3_600_000).length;

  let score = 20;
  score += Math.min(40, breadth * 12); // present across many platforms
  score += Math.min(25, volume * 1.2); // lots of chatter
  score += Math.min(15, recentCount * 1.5); // and it's recent

  const reasons: string[] = [];
  if (breadth >= 3) reasons.push(`spreading across ${breadth} platforms`);
  if (recentCount >= 5) reasons.push(`${recentCount} posts in the last 6h`);
  if (breadth <= 1 && volume < 5) reasons.push("thin, single-channel chatter");

  return { score: clamp(score), breadth, volume, recentCount, reasons };
}
