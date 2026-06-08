// ─────────────────────────────────────────────────────────────────────────────
// Project Athena — Attention Intelligence types.
// Attention precedes price: we measure WHY humans are paying attention to a coin,
// from evidence collected across the open web. All scoring agents are PURE so they
// are deterministic + unit-testable; the I/O (browser collection, LLM judge) lives
// elsewhere and only produces the AttentionEvidence these agents consume.
// ─────────────────────────────────────────────────────────────────────────────

/** A single piece of public chatter discovered about a coin/meme. */
export interface AttentionPost {
  text: string;
  author?: string;
  /** "twitter" | "reddit" | "youtube" | "tiktok" | "telegram" | "web" | "news" | ... */
  platform: string;
  /** ms epoch, if known. */
  at?: number;
  /** likes / upvotes / views, if known. */
  reactions?: number;
}

/** Everything the ResearchAgent collected for one coin in one pass. */
export interface AttentionEvidence {
  mint: string;
  symbol?: string;
  name?: string;
  query: string;
  posts: AttentionPost[];
  /** Platforms where ANY presence (page/profile/result) was found. */
  platforms: string[];
  links: { url: string; platform: string }[];
  fetchedAt: number;
}

/** The attention pillar's output (0..100 each unless noted). */
export interface AttentionScores {
  humanity: number;
  virality: number;
  outsideCrypto: number;
  culturalStrength: number;
  /** Weighted composite, 0..100. */
  attention: number;
  /** 0..1 — how much evidence backs this (volume + platform breadth). */
  confidence: number;
  /** Cultural hook tags (humor, nostalgia, …). */
  tags: string[];
  /** One-line human summary. */
  narrative: string;
  reasons: string[];
}

export function clamp(x: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
}
export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** Normalize chatter text for dedup/diversity (strip urls, $tickers, punctuation). */
export function normalizeText(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[$#@][a-z0-9_]+/gi, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
