import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../db.js";
import { AttentionRepo } from "./attentionRepo.js";
import type { AttentionRecord } from "../../attention/attentionService.js";

const rec = (mint: string, attn: number, at: number): AttentionRecord => ({
  mint,
  at,
  source: "heuristic",
  scores: { humanity: 80, virality: 60, outsideCrypto: 70, culturalStrength: 50, attention: attn, confidence: 0.7, tags: ["humor"], narrative: `attention ${attn}`, reasons: ["r1"] },
  evidence: { mint, symbol: "SYM", name: "Name", query: "q", posts: [{ text: "hello world", platform: "news" }], platforms: ["news", "wikipedia"], links: [], fetchedAt: at },
});

describe("AttentionRepo (durable graveyard)", () => {
  let db: DB;
  beforeEach(() => { db = openDb(":memory:"); });
  afterEach(() => db.close());

  it("upserts latest-per-mint and reads back records newest-first", () => {
    const repo = new AttentionRepo(db);
    repo.upsert(rec("A", 50, 1000));
    repo.upsert(rec("A", 75, 2000)); // newer ⇒ overwrites
    repo.upsert(rec("B", 60, 1500));

    expect(repo.count()).toBe(2);
    expect(repo.get("A")?.scores.attention).toBe(75);
    expect(repo.get("A")?.evidence.platforms).toContain("wikipedia");

    const recent = repo.recent(10);
    expect(recent[0].mint).toBe("A"); // at=2000 newest
    expect(recent[1].mint).toBe("B");
    expect(recent[0].evidence.posts[0].text).toBe("hello world");
    expect(recent[0].scores.narrative).toBe("attention 75");
  });
});
