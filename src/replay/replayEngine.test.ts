import { describe, it, expect } from "vitest";
import { replayStrategies, rankStrategies } from "./replayEngine.js";
import { leagueWeights } from "./strategyLeague.js";
import type { ReplayEvent } from "./eventRecorder.js";
import { emptyScores } from "../types.js";

function ev(gainPct: number, organic = 80, momentum = 85): ReplayEvent {
  return {
    mint: "M",
    at: 0,
    verdict: "BUY_STRONG",
    scores: { ...emptyScores(), safety: 90, organic, momentum, graduation: 80, devReputation: 70, smartMoney: 80, social: 70, hype: 60, lateEntryRisk: 10 },
    safetyPass: true,
    unknownCount: 0,
    maxGainPct: gainPct,
    maxDrawdownPct: 20,
  };
}

const EVENTS: ReplayEvent[] = [ev(300), ev(150), ev(40, 50, 55), ev(220)];

describe("replayStrategies", () => {
  it("is deterministic — same events ⇒ identical results", () => {
    const a = replayStrategies(EVENTS);
    const b = replayStrategies(EVENTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("runs every league strategy and reports trades + pnl", () => {
    const results = replayStrategies(EVENTS);
    expect(results.length).toBeGreaterThanOrEqual(6);
    for (const r of results) expect(r.trades).toBeGreaterThanOrEqual(0);
  });

  it("a conservative strategy admits no more trades than an aggressive one", () => {
    const results = replayStrategies(EVENTS);
    const cons = results.find((r) => r.name === "conservative")!;
    const aggr = results.find((r) => r.name === "aggressive")!;
    expect(cons.trades).toBeLessThanOrEqual(aggr.trades);
  });

  it("rankStrategies orders by total PnL desc", () => {
    const ranked = rankStrategies(replayStrategies(EVENTS));
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.totalPnlSol).toBeGreaterThanOrEqual(ranked[i]!.totalPnlSol);
    }
  });

  it("leagueWeights are bounded to [0.5, 1.5]", () => {
    const w = leagueWeights([{ name: "a", totalPnlSol: 100 }, { name: "b", totalPnlSol: -100 }]);
    for (const v of Object.values(w)) {
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });
});
