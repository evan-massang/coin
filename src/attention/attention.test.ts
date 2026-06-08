import { describe, it, expect } from "vitest";
import { computeHumanity } from "./humanityAgent.js";
import { computeVirality } from "./viralityAgent.js";
import { computeOutsideCrypto } from "./outsideCryptoAgent.js";
import { computeCulturalStrength } from "./culturalStrengthAgent.js";
import { computeAttention } from "./attentionAgent.js";
import type { AttentionEvidence, AttentionPost } from "./types.js";

const NOW = 1_000_000_000_000;
const ev = (posts: AttentionPost[], over: Partial<AttentionEvidence> = {}): AttentionEvidence => ({
  mint: "M", query: "q", posts, platforms: [], links: [], fetchedAt: NOW, ...over,
});

describe("humanityAgent", () => {
  it("scores genuine multi-author varied chatter HIGH", () => {
    const posts: AttentionPost[] = [
      { text: "this dog meme is hilarious lol", author: "a", platform: "twitter" },
      { text: "my whole timeline is this lil guy now", author: "b", platform: "twitter" },
      { text: "ok the animation edits are sending me", author: "c", platform: "reddit" },
      { text: "found him on tiktok yesterday actually", author: "d", platform: "tiktok" },
      { text: "the energy here is unmatched honestly", author: "e", platform: "twitter" },
    ];
    const r = computeHumanity(posts);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.uniqueAuthorRatio).toBe(1);
  });

  it("scores a copy-paste bot farm LOW", () => {
    const spam = "🚀 $DOG to the moon buy now 🚀";
    const posts: AttentionPost[] = Array.from({ length: 10 }, (_, i) => ({ text: spam, author: `bot${i % 2}`, platform: "telegram" }));
    const r = computeHumanity(posts);
    expect(r.score).toBeLessThan(45);
    expect(r.duplicateRatio).toBeGreaterThan(0.6);
    expect(r.reasons.join(" ")).toMatch(/copy-paste|dominat/i);
  });
});

describe("viralityAgent", () => {
  it("rewards cross-platform recent spread", () => {
    const posts: AttentionPost[] = ["twitter", "reddit", "tiktok", "youtube"].flatMap((pl) =>
      [0, 1].map((i) => ({ text: `post ${pl} ${i}`, author: `${pl}${i}`, platform: pl, at: NOW - 3_600_000 })),
    );
    const wide = computeVirality(ev(posts), NOW);
    const narrow = computeVirality(ev([{ text: "lonely post", platform: "telegram" }]), NOW);
    expect(wide.score).toBeGreaterThan(narrow.score);
    expect(wide.breadth).toBe(4);
  });
});

describe("outsideCryptoAgent", () => {
  it("rewards non-crypto-platform + non-trade-frame chatter", () => {
    const outside = ev([
      { text: "this sound is everywhere on my fyp lol", platform: "tiktok" },
      { text: "made an edit of the little guy", platform: "youtube" },
      { text: "he's so cute haha", platform: "tiktok" },
    ]);
    const cryptoOnly = ev([
      { text: "$DOG pumping, send it, mcap low, ape now", platform: "telegram" },
      { text: "buy the dip, liquidity locked, chart looks ready", platform: "telegram" },
    ]);
    expect(computeOutsideCrypto(outside).score).toBeGreaterThan(computeOutsideCrypto(cryptoOnly).score);
  });
});

describe("culturalStrengthAgent", () => {
  it("detects emotional hooks", () => {
    const r = computeCulturalStrength(ev([
      { text: "this is so cute and wholesome haha brings me back to childhood", platform: "twitter", reactions: 500 },
    ]));
    expect(r.tags.length).toBeGreaterThanOrEqual(2);
    expect(r.score).toBeGreaterThan(50);
  });
});

describe("attentionAgent composite", () => {
  it("organic viral real-world meme scores far above a crypto-only bot farm", () => {
    const good = computeAttention(ev([
      { text: "lmao this dog is taking over tiktok", author: "a", platform: "tiktok", at: NOW - 1_000_000, reactions: 900 },
      { text: "wholesome king, made an edit", author: "b", platform: "youtube", at: NOW - 2_000_000 },
      { text: "my niece showed me this one haha", author: "c", platform: "twitter", at: NOW - 500_000 },
      { text: "the community memes are unreal", author: "d", platform: "reddit", at: NOW - 800_000 },
    ]));
    const spam = "🚀 buy $DOG now moon mcap pump send it 🚀";
    const bad = computeAttention(ev(Array.from({ length: 8 }, (_, i) => ({ text: spam, author: `bot${i % 2}`, platform: "telegram" }))));
    expect(good.attention).toBeGreaterThan(bad.attention + 15);
    expect(good.confidence).toBeGreaterThan(0);
    expect(good.narrative).toMatch(/attention \d+/);
  });
});
