import { describe, it, expect } from "vitest";
import { buildCaseFile, type CaseFileInput } from "./caseFile.js";
import type { SignalRecord } from "../store/repositories/signalsRepo.js";
import { emptyScores } from "../types.js";

function sig(over: Partial<SignalRecord>): SignalRecord {
  return {
    id: 1,
    mint: "M",
    symbol: "DOGE",
    at: 1,
    verdict: "WATCH_ONLY",
    conviction: 49,
    scores: emptyScores(),
    reasons: [],
    flags: [],
    caps: [],
    ...over,
  };
}

const base: CaseFileInput = {
  mint: "M",
  signals: [
    sig({ at: 100, verdict: "WATCH_ONLY", conviction: 49, caps: ["awaiting-attention⇒WATCH"] }),
    sig({ at: 200, verdict: "BUY_SMALL", conviction: 58, reasons: ["attention re-score (WATCH_ONLY→BUY_SMALL)"], maxGainPct: 120, maxDrawdownPct: -30 }),
  ],
  council: [
    { id: 1, at: 150, mint: "M", memberId: "bull", label: "Bull", role: "bull_analyst", score: 70, recommendation: "confirm", rationale: "x", outcome: "win" },
    { id: 2, at: 150, mint: "M", memberId: "risk", label: "Risk", role: "risk_analyst", score: 40, recommendation: "caution", rationale: "y" },
  ],
  fills: [
    { id: 2, mint: "M", side: "sell", priceUsd: 2, solAmount: 0.6, tokenAmount: 100, realizedPnlSol: 0.1, remainingTokenAmount: 0, reason: "SELL_TRIM", at: 300 },
    { id: 1, mint: "M", side: "buy", priceUsd: 1, solAmount: 0.5, tokenAmount: 200, realizedPnlSol: 0, remainingTokenAmount: 200, reason: "BUY_SMALL", at: 250 },
  ],
  missions: [],
  now: 9_999,
};

function attRec(attention: number) {
  return {
    mint: "M", at: 180, source: "manus",
    scores: { humanity: 50, virality: 50, outsideCrypto: 50, culturalStrength: 50, attention, confidence: 0.7, tags: [] as string[], narrative: "n" },
    evidence: { mint: "M", query: "M", posts: [], platforms: [], links: [], fetchedAt: 180 },
  };
}

describe("buildCaseFile", () => {
  it("assembles current + a verdict-evolution timeline oldest→newest", () => {
    const cf = buildCaseFile(base);
    expect(cf.current).toEqual({ verdict: "BUY_SMALL", conviction: 58, at: 200 });
    expect(cf.timeline.map((t) => t.verdict)).toEqual(["WATCH_ONLY", "BUY_SMALL"]);
    expect(cf.timeline[0].caps).toContain("awaiting-attention⇒WATCH");
    expect(cf.symbol).toBe("DOGE");
    expect(cf.generatedAt).toBe(9_999);
  });

  it("summarizes council (sessions/confirms/cautions/resolved/wins)", () => {
    const cf = buildCaseFile(base);
    expect(cf.council.sessions).toBe(1); // both at=150
    expect(cf.council.confirms).toBe(1);
    expect(cf.council.cautions).toBe(1);
    expect(cf.council.resolved).toBe(1);
    expect(cf.council.wins).toBe(1);
  });

  it("rolls up trades (buys/sells/realized) and the best-gain / worst-draw outcome", () => {
    const cf = buildCaseFile(base);
    expect(cf.trades.buys).toBe(1);
    expect(cf.trades.sells).toBe(1);
    expect(cf.trades.realizedPnlSol).toBeCloseTo(0.1, 5);
    expect(cf.trades.lastReason).toBe("SELL_TRIM"); // newest fill
    expect(cf.outcome.maxGainPct).toBe(120);
    expect(cf.outcome.maxDrawdownPct).toBe(-30);
    expect(cf.outcome.resolved).toBe(true);
  });

  it("includes missions with their recommendation + provider", () => {
    const cf = buildCaseFile({
      ...base,
      missions: [
        {
          id: 7, mint: "M", status: "resolved", createdAt: 400, provider: "manus",
          verdict: "BUY_SMALL", conviction: 58,
          mission: { mint: "M", objective: "o", verdict: "BUY_SMALL", conviction: 58, buckets: [], gaps: ["attention"], outputContract: "c", createdAt: 400 },
          result: { recommendation: "confirm", confidence: 80 },
        },
      ],
    });
    expect(cf.missions).toHaveLength(1);
    expect(cf.missions[0]).toMatchObject({ id: 7, status: "resolved", recommendation: "confirm", provider: "manus", gaps: ["attention"] });
  });

  it("research is null when no attention record, populated when present", () => {
    expect(buildCaseFile(base).research).toBeNull();
    const cf = buildCaseFile({
      ...base,
      attention: {
        mint: "M", at: 180, source: "manus",
        scores: { humanity: 60, virality: 55, outsideCrypto: 40, culturalStrength: 50, attention: 64.4, confidence: 0.7, tags: [], narrative: "spreading" },
        evidence: { mint: "M", query: "DOGE", posts: [], platforms: [], links: [], fetchedAt: 180 },
      },
    });
    expect(cf.research).toEqual({ attention: 64, confidence: 0.7, source: "manus", narrative: "spreading" });
  });

  it("derives the entry thesis from the first BUY signal (Phase 11)", () => {
    const cf = buildCaseFile({
      ...base,
      signals: [
        sig({ at: 100, verdict: "WATCH_ONLY", conviction: 49 }),
        sig({ at: 200, verdict: "BUY_SMALL", conviction: 58, scores: { ...emptyScores(), attention: 70 }, reasons: ["attention re-score (WATCH_ONLY→BUY_SMALL): dog meme spreading"] }),
        sig({ at: 300, verdict: "SELL_TRIM", conviction: 58 }),
      ],
    });
    expect(cf.thesis).toMatchObject({ verdict: "BUY_SMALL", conviction: 58, attentionAtEntry: 70 });
    expect(cf.thesis?.keyReasons[0]).toMatch(/dog meme/);
  });

  it("thesisHealth compares entry vs current attention — advisory, read-only (Phase 13)", () => {
    const signals = [sig({ at: 200, verdict: "BUY_SMALL", conviction: 58, scores: { ...emptyScores(), attention: 70 } })];
    expect(buildCaseFile({ ...base, signals, attention: attRec(66) }).thesisHealth?.status).toBe("intact"); // -4
    expect(buildCaseFile({ ...base, signals, attention: attRec(58) }).thesisHealth?.status).toBe("weakening"); // -12
    expect(buildCaseFile({ ...base, signals, attention: attRec(40) }).thesisHealth?.status).toBe("broken"); // -30
  });

  it("no thesis / health when the coin was never a BUY", () => {
    const cf = buildCaseFile({ ...base, signals: [sig({ verdict: "WATCH_ONLY" })], attention: attRec(50) });
    expect(cf.thesis).toBeNull();
    expect(cf.thesisHealth).toBeNull();
  });
});
