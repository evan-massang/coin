import { describe, it, expect } from "vitest";
import { buildConsensus } from "./consensus.js";
import type { CouncilMemberResult, CouncilEvidence } from "../aiComputer/councilShared.js";

function member(over: Partial<CouncilMemberResult>): CouncilMemberResult {
  return { id: "m", label: "M", role: "bull_analyst", score: 70, recommendation: "confirm", rationale: "x", ms: 1, ...over };
}
const ev: CouncilEvidence = {
  symbol: "X", bullCount: 3, bearCount: 1, bullPoints: ["a", "b"], bearPoints: ["c"],
  clusterDetected: true, smartMoney: true, devSold: false, rugMatch: false,
};

describe("buildConsensus", () => {
  it("no seats ⇒ undefined", () => {
    expect(buildConsensus([], ev)).toBeUndefined();
  });

  it("confirming majority + healthy score ⇒ confirm", () => {
    const c = buildConsensus(
      [member({ id: "a", score: 80, recommendation: "confirm" }), member({ id: "b", score: 70, recommendation: "confirm" }), member({ id: "c", score: 40, recommendation: "caution" })],
      ev,
    )!;
    expect(c.recommendation).toBe("confirm");
    expect(c.bullModels).toBe(2);
    expect(c.agreement).toBe(67);
  });

  it("split / weak score ⇒ caution (skeptical default)", () => {
    const c = buildConsensus([member({ id: "a", score: 40, recommendation: "caution" }), member({ id: "b", score: 50, recommendation: "confirm" })], ev)!;
    expect(c.recommendation).toBe("caution");
  });

  it("weights tilt the blended score", () => {
    const seats = [member({ id: "a", score: 90, recommendation: "confirm" }), member({ id: "b", score: 30, recommendation: "caution" })];
    const equal = buildConsensus(seats, ev)!;
    const weighted = buildConsensus(seats, ev, { a: 1.6, b: 0.4 })!;
    expect(weighted.score).toBeGreaterThan(equal.score);
  });

  it("shared evidence follows the consensus direction", () => {
    const bull = buildConsensus([member({ id: "a", score: 80, recommendation: "confirm" }), member({ id: "b", score: 75, recommendation: "confirm" })], ev)!;
    expect(bull.sharedEvidence).toEqual(["a", "b"]);
  });
});
