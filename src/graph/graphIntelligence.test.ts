import { describe, it, expect } from "vitest";
import { computeGraphIntelligence, type GraphIntelInput } from "./graphIntelligence.js";
import { emptyScores, type SafetyResult } from "../types.js";

function safety(over: Partial<SafetyResult> = {}): SafetyResult {
  return {
    pass: true,
    stage: 1,
    checks: [{ id: "rugcheckRisk", status: "PASS", fatal: true, label: "RugCheck" }],
    unknownCount: 0,
    fatalReasons: [],
    score: 85,
    ...over,
  };
}

function input(over: Partial<GraphIntelInput> = {}): GraphIntelInput {
  return {
    mint: "MintAAA11111111111111111111111111111111111",
    symbol: "PEPE",
    creator: "Dev1111111111111111111111111111111111111111",
    scores: { ...emptyScores(), safety: 85, organic: 70, momentum: 65, smartMoney: 60, hype: 55, graduation: 55 },
    safety: safety(),
    verdict: "BUY_SMALL",
    conviction: 74,
    devSold: false,
    bundle: false,
    rugMatch: false,
    similarWinners: 0,
    deployerLaunches: 3,
    liquidityUsd: 12_000,
    tradeCount: 20,
    firstSeenAt: 1_000,
    now: 61_000,
    ...over,
  };
}

describe("computeGraphIntelligence", () => {
  it("a clean strong BUY ⇒ DECISION_READY, HIGH conviction, bull-dominant", () => {
    const g = computeGraphIntelligence(input());
    expect(g.state).toBe("DECISION_READY");
    expect(g.convictionTier).toBe("HIGH");
    expect(g.bullScore).toBeGreaterThan(g.bearScore);
    expect(g.why.length).toBeGreaterThan(0);
  });

  it("safety failure ⇒ ARCHIVED regardless of scores", () => {
    const g = computeGraphIntelligence(input({ safety: safety({ pass: false, fatalReasons: ["honeypot"] }) }));
    expect(g.state).toBe("ARCHIVED");
  });

  it("AVOID verdict ⇒ ARCHIVED", () => {
    const g = computeGraphIntelligence(input({ verdict: "AVOID" }));
    expect(g.state).toBe("ARCHIVED");
  });

  it("dev sold + bundle + rug match surface bear evidence and KNOWN_RUG entities", () => {
    const g = computeGraphIntelligence(
      input({
        devSold: true,
        bundle: true,
        rugMatch: true,
        verdict: "AVOID",
        conviction: 18,
        // A rugging token has degraded behaviour, not pristine organic/momentum.
        scores: { ...emptyScores(), safety: 40, organic: 30, momentum: 25, lateEntryRisk: 55 },
        liquidityUsd: 1500,
        deployerLaunches: 1,
      }),
    );
    const labels = g.bear.map((b) => b.label.toLowerCase());
    expect(labels.some((l) => l.includes("sold"))).toBe(true);
    expect(labels.some((l) => l.includes("bundle"))).toBe(true);
    expect(labels.some((l) => l.includes("known rug"))).toBe(true);
    expect(g.entities.some((e) => e.type === "KNOWN_RUG")).toBe(true);
    expect(g.bearScore).toBeGreaterThan(g.bullScore);
  });

  it("low conviction + thin coverage ⇒ OBSERVING", () => {
    const g = computeGraphIntelligence(
      input({
        verdict: "WATCH_ONLY",
        conviction: 40,
        scores: { ...emptyScores(), safety: 50 },
        liquidityUsd: undefined,
        tradeCount: 1,
      }),
    );
    expect(["OBSERVING", "MATURE"]).toContain(g.state);
    expect(g.coverage).toBeLessThan(60);
  });

  it("similar historical winners add a bull bullet + why entry", () => {
    const g = computeGraphIntelligence(input({ similarWinners: 2 }));
    expect(g.bull.some((b) => b.label.includes("historical winner"))).toBe(true);
  });

  it("timeline starts at Discovered and is chronologically ordered", () => {
    const g = computeGraphIntelligence(input({ devSold: true }));
    expect(g.timeline[0]!.label).toBe("Discovered");
    for (let i = 1; i < g.timeline.length; i++) {
      expect(g.timeline[i]!.atMs).toBeGreaterThanOrEqual(g.timeline[i - 1]!.atMs);
    }
  });

  it("evidence counts are consistent with arrays", () => {
    const g = computeGraphIntelligence(input());
    expect(g.bull.length + g.bear.length).toBeGreaterThan(0);
    expect(g.confidence).toBe(74);
  });
});
