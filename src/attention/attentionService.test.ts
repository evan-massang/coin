import { describe, it, expect, vi } from "vitest";
import { AttentionService, makeScorer } from "./attentionService.js";
import type { AttentionEvidence, AttentionScores } from "./types.js";

const ev = (mint: string): AttentionEvidence => ({ mint, query: "q", posts: [], platforms: [], links: [], fetchedAt: 0 });
const scores = (attention: number): AttentionScores => ({ humanity: attention, virality: attention, outsideCrypto: attention, culturalStrength: attention, attention, confidence: 0.8, tags: [], narrative: "n", reasons: [] });

describe("AttentionService", () => {
  it("researches once, caches, fires onComplete, and serves get()", async () => {
    const collect = vi.fn(async (c: { mint: string }) => ev(c.mint));
    const done: string[] = [];
    let clock = 1000;
    const svc = new AttentionService({ collect, score: async () => ({ scores: scores(70), source: "heuristic" }), onComplete: (r) => done.push(r.mint), now: () => clock });

    svc.request({ mint: "A" });
    svc.request({ mint: "A" }); // deduped while queued
    await svc.whenIdle();

    expect(collect).toHaveBeenCalledTimes(1);
    expect(done).toEqual(["A"]);
    expect(svc.get("A")?.attention).toBe(70);

    // within TTL ⇒ no re-research
    svc.request({ mint: "A" });
    await svc.whenIdle();
    expect(collect).toHaveBeenCalledTimes(1);

    // after TTL ⇒ re-research
    clock += 31 * 60_000;
    svc.request({ mint: "A" });
    await svc.whenIdle();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("respects enabled() but `force` overrides", async () => {
    const collect = vi.fn(async (c: { mint: string }) => ev(c.mint));
    const svc = new AttentionService({ collect, score: async () => ({ scores: scores(50), source: "heuristic" }), enabled: () => false });
    svc.request({ mint: "B" });
    await svc.whenIdle();
    expect(collect).not.toHaveBeenCalled();
    svc.request({ mint: "B" }, true); // force
    await svc.whenIdle();
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("a thrown collector doesn't wedge the queue", async () => {
    const collect = vi.fn(async () => { throw new Error("network"); });
    const svc = new AttentionService({ collect, score: async () => ({ scores: scores(1), source: "heuristic" }) });
    svc.request({ mint: "C" });
    await svc.whenIdle();
    expect(svc.get("C")).toBeUndefined();
    // queue recovered — a later good request still works
    const good = vi.fn(async (c: { mint: string }) => ev(c.mint));
    const svc2 = new AttentionService({ collect: good, score: async () => ({ scores: scores(9), source: "heuristic" }) });
    svc2.request({ mint: "D" });
    await svc2.whenIdle();
    expect(svc2.get("D")?.attention).toBe(9);
  });

  it("makeScorer falls back to heuristic when no LLM model is configured", async () => {
    const scorer = makeScorer(() => ({ baseUrl: "http://localhost:11434", model: "" }));
    const r = await scorer({ mint: "E", query: "e", posts: [{ text: "lol cute dog", author: "a", platform: "twitter" }, { text: "haha so funny", author: "b", platform: "reddit" }, { text: "wholesome king", author: "c", platform: "tiktok" }], platforms: ["twitter", "reddit", "tiktok"], links: [], fetchedAt: 0 });
    expect(r.source).toBe("heuristic");
    expect(r.scores.attention).toBeGreaterThan(0);
  });
});
