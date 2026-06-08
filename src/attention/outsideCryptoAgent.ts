import { type AttentionEvidence, clamp } from "./types.js";

// Phase 6 — Outside-Crypto Intelligence. "Does this meme exist OUTSIDE crypto?"
// The operator's key insight: a meme that's already a real-world joke/trend (a
// TikTok sound, a viral clip, a cultural moment) has ~10x the viral ceiling of a
// crypto-only meme — non-crypto people can become buyers. PURE.

const NON_CRYPTO_PLATFORMS = new Set(["tiktok", "youtube", "instagram", "facebook", "news"]);

// If a post mentions none of these, it's likely discussing the meme itself, not
// the coin/trade — i.e. it exists in a non-crypto frame.
const CRYPTO_FRAME =
  /\b(pump|moon|ape|aping|degen|mcap|market\s?cap|liquidity|chart|dex|dexscreener|solana|\bsol\b|token|coin|hodl|rug|rugged|ath|presale|airdrop|holders?|buy\s?in|send\s?it|lp|ca:)\b|\$[a-z]{2,}/i;

export interface OutsideCryptoResult {
  score: number; // 0..100
  nonCryptoPlatformHits: number;
  nonCryptoRatio: number; // posts with no crypto framing / posts
  reasons: string[];
}

export function computeOutsideCrypto(ev: AttentionEvidence): OutsideCryptoResult {
  const platforms = new Set(ev.posts.map((p) => p.platform));
  for (const pl of ev.platforms) platforms.add(pl);
  const nonCryptoPlatformHits = [...platforms].filter((p) => NON_CRYPTO_PLATFORMS.has(p)).length;

  const nonCryptoPosts = ev.posts.filter((p) => !CRYPTO_FRAME.test(p.text)).length;
  const nonCryptoRatio = ev.posts.length ? nonCryptoPosts / ev.posts.length : 0;

  let score = 15;
  score += Math.min(40, nonCryptoPlatformHits * 20); // seen on TikTok/YouTube/etc
  score += nonCryptoRatio * 45; // discussed without a trade frame

  const reasons: string[] = [];
  if (nonCryptoPlatformHits > 0) reasons.push(`present on ${nonCryptoPlatformHits} non-crypto platform(s)`);
  if (nonCryptoRatio >= 0.4) reasons.push("discussed outside a crypto/trading frame");
  if (nonCryptoPlatformHits === 0 && nonCryptoRatio < 0.2) reasons.push("crypto-only meme (lower ceiling)");

  return { score: clamp(score), nonCryptoPlatformHits, nonCryptoRatio, reasons };
}
