import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "./providerRegistry.js";
import type { ResearchProvider, ResearchResult } from "./researchProvider.js";
import type { CoinRef } from "../attention/attentionService.js";
import type { AttentionEvidence, AttentionScores } from "../attention/types.js";

const scores = (a: number): AttentionScores => ({ humanity: a, virality: a, outsideCrypto: a, culturalStrength: a, attention: a, confidence: 0.5, tags: [], narrative: "n", reasons: [] });
const ev = (mint: string): AttentionEvidence => ({ mint, query: "q", posts: [], platforms: [], links: [], fetchedAt: 0 });

function provider(name: string, isAvail: boolean, attn = 50): ResearchProvider {
  return {
    name,
    available: () => isAvail,
    research: async (c: CoinRef): Promise<ResearchResult> => ({ scores: scores(attn), evidence: ev(c.mint), source: name, provider: name }),
  };
}

describe("ProviderRegistry", () => {
  it("picks the first AVAILABLE provider in preference order (falls through to the fallback)", () => {
    const r = new ProviderRegistry();
    r.register(provider("manus", false)).register(provider("athena", true));
    expect(r.pick()?.name).toBe("athena");
    expect(r.activeName()).toBe("athena");
    expect(r.names()).toEqual(["manus", "athena"]);
  });

  it("prefers an available preferred provider OVER the always-on fallback", () => {
    const r = new ProviderRegistry();
    r.register(provider("manus", true, 90)).register(provider("athena", true, 10));
    expect(r.pick()?.name).toBe("manus");
  });

  it("research() delegates to the picked provider", async () => {
    const r = new ProviderRegistry();
    r.register(provider("manus", false)).register(provider("athena", true, 77));
    const out = await r.research({ mint: "M" });
    expect(out.provider).toBe("athena");
    expect(out.scores.attention).toBe(77);
  });

  it("available() is false and research() throws when nothing can run", async () => {
    const r = new ProviderRegistry();
    r.register(provider("manus", false));
    expect(r.available()).toBe(false);
    await expect(r.research({ mint: "M" })).rejects.toThrow(/no research provider/);
  });
});
