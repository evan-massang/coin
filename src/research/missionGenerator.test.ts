import { describe, it, expect } from "vitest";
import { generateMission } from "./missionGenerator.js";
import type { Decision, SafetyResult } from "../types.js";
import { emptyScores } from "../types.js";
import type { AttentionRecord } from "../attention/attentionService.js";

function decision(over: Partial<Decision> = {}): Decision {
  return {
    mint: "MINT1",
    symbol: "DOGE",
    verdict: "WATCH_ONLY",
    conviction: 50,
    scores: { ...emptyScores(), momentum: 70, social: 40, hype: 30, recentM5Pct: 12, recentH1Pct: 40 },
    reasons: [],
    flags: [],
    caps: [],
    redFlags: ["dev holds 18%"],
    at: 1,
    ...over,
  };
}

function safety(over: Partial<SafetyResult> = {}): SafetyResult {
  return {
    pass: true,
    stage: 1,
    checks: [
      { id: "mintAuthority", status: "PASS", fatal: true, label: "Mint authority revoked" },
      { id: "topHolderPct", status: "UNKNOWN", fatal: false, label: "Top holder %" },
    ],
    unknownCount: 1,
    fatalReasons: [],
    score: 75,
    ...over,
  };
}

function attRecord(attention: number, confidence: number): AttentionRecord {
  return {
    mint: "MINT1",
    at: 5,
    source: "heuristic",
    scores: { humanity: 60, virality: 55, outsideCrypto: 40, culturalStrength: 50, attention, confidence, tags: ["humor"], narrative: "a dog meme spreading on TikTok" },
    evidence: { mint: "MINT1", query: "DOGE", posts: [{ text: "lol", author: "a", platform: "tiktok" }, { text: "cute", author: "b", platform: "twitter" }], platforms: ["tiktok", "twitter"], links: [], fetchedAt: 5 },
  };
}

const NOW = 1_700_000_000_000;

describe("generateMission", () => {
  it("composes all 9 buckets and is deterministic on `now`", () => {
    const m = generateMission({ decision: decision(), safety: safety(), now: NOW });
    expect(m.buckets.map((b) => b.key)).toEqual([
      "rugcheck", "holders", "liquidity", "chart", "social", "narrative", "attention", "influencer", "bearCase",
    ]);
    expect(m.createdAt).toBe(NOW);
    // re-running with the same inputs yields an identical mission
    expect(generateMission({ decision: decision(), safety: safety(), now: NOW })).toEqual(m);
  });

  it("pre-fills KNOWN evidence the engine already collected", () => {
    const m = generateMission({ decision: decision(), safety: safety(), liquidityUsd: 42_000, now: NOW });
    const rug = m.buckets.find((b) => b.key === "rugcheck")!;
    expect(rug.known.join(" ")).toMatch(/Mint authority revoked: PASS/);
    const liq = m.buckets.find((b) => b.key === "liquidity")!;
    expect(liq.known.join(" ")).toMatch(/\$42,000/);
    expect(liq.coverage).toBe(1);
    const chart = m.buckets.find((b) => b.key === "chart")!;
    expect(chart.known.join(" ")).toMatch(/run-up m5 \+12%/);
    const bear = m.buckets.find((b) => b.key === "bearCase")!;
    expect(bear.known).toContain("dev holds 18%");
  });

  it("flags THIN buckets as gaps — attention/holders/liquidity are thin when unresearched", () => {
    const m = generateMission({ decision: decision(), safety: safety(), now: NOW });
    expect(m.gaps).toContain("attention"); // no research yet
    expect(m.gaps).toContain("holders"); // UNKNOWN check
    expect(m.gaps).toContain("liquidity"); // no liquidity passed
    const att = m.buckets.find((b) => b.key === "attention")!;
    expect(att.coverage).toBe(0);
    expect(att.thin).toBe(true);
  });

  it("attention bucket coverage tracks research confidence; resolved ⇒ not a gap", () => {
    const m = generateMission({ decision: decision(), safety: safety(), attention: attRecord(64, 0.8), now: NOW });
    const att = m.buckets.find((b) => b.key === "attention")!;
    expect(att.coverage).toBe(0.8);
    expect(att.thin).toBe(false);
    expect(m.gaps).not.toContain("attention");
    // influencer coverage scales with unique authors (2/5)
    const inf = m.buckets.find((b) => b.key === "influencer")!;
    expect(inf.coverage).toBeCloseTo(0.4, 5);
  });

  it("objective is attention-first and the output contract is strict + advisory", () => {
    const m = generateMission({ decision: decision({ verdict: "BUY_SMALL", conviction: 58 }), safety: safety(), now: NOW });
    expect(m.objective).toMatch(/2-12h/);
    expect(m.objective).toMatch(/attention is the asset/i);
    expect(m.verdict).toBe("BUY_SMALL");
    expect(m.outputContract).toMatch(/"recommendation"/);
    expect(m.outputContract).toMatch(/ADVISORY/);
  });
});
