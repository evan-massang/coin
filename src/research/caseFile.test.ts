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
});
