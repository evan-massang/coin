// Meme-revival detection (§1.7): a new token echoing an established meme name
// ("son of doge", "pepe 2.0", …) often catches a nostalgia bid. Pure.

export interface RevivalMatch {
  isRevival: boolean;
  match?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectRevival(text: string, knownMemes: string[]): RevivalMatch {
  const t = text.toLowerCase();
  for (const meme of knownMemes) {
    const m = meme.toLowerCase();
    if (m.length < 3) continue;
    // Prefer a word-boundary match; fall back to substring for short tickers.
    if (new RegExp(`\\b${escapeRegex(m)}\\b`).test(t) || t.includes(m)) {
      return { isRevival: true, match: meme };
    }
  }
  return { isRevival: false };
}
