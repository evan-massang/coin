import { describe, it, expect } from "vitest";
import { normalizeVerdict, parseVerdict, parseDebate } from "./councilShared.js";
import { buildConsensus } from "../council/consensus.js";
import type { CouncilMemberResult, CouncilEvidence } from "./councilShared.js";

// Operator teardown fixes: verdict/score consistency is now DETERMINISTIC (the
// score is authoritative), reject exists and is reachable, and a rejecting
// majority produces a REJECT consensus.

describe("normalizeVerdict — the consistency clamp", () => {
  it("confirm requires score ≥ 65 (the 'CONFIRM 40' class dies)", () => {
    expect(normalizeVerdict(40, "confirm")).toBe("caution");
    expect(normalizeVerdict(54, "confirm")).toBe("caution");
    expect(normalizeVerdict(70, "confirm")).toBe("confirm");
  });
  it("reject requires score ≤ 35", () => {
    expect(normalizeVerdict(20, "reject")).toBe("reject");
    expect(normalizeVerdict(50, "reject")).toBe("caution");
  });
  it("the score overrides a contradicting verdict in BOTH directions", () => {
    expect(normalizeVerdict(80, "caution")).toBe("confirm"); // strong case stated weakly
    expect(normalizeVerdict(10, "caution")).toBe("reject"); // terrible case stated softly
    expect(normalizeVerdict(80, "reject")).toBe("caution"); // self-contradiction → middle
    expect(normalizeVerdict(10, "confirm")).toBe("caution");
  });
});

describe("parseVerdict — JSON path is clamped + reject is parseable", () => {
  it("CONFIRM 40 from a model lands as caution in the journal", () => {
    const v = parseVerdict('{"score": 40, "recommendation": "confirm", "rationale": "insufficient data, no bullish indicators"}');
    expect(v?.recommendation).toBe("caution");
  });
  it("reject round-trips", () => {
    const v = parseVerdict('{"score": 15, "recommendation": "reject", "rationale": "matches known rug; dev sold"}');
    expect(v?.recommendation).toBe("reject");
    expect(v?.score).toBe(15);
  });
});

describe("parseDebate — CALL line supports reject and is clamped", () => {
  it("CALL: reject SCORE: 20 parses as reject", () => {
    const d = parseDebate("This one is a rug pattern, I'm out.\nCALL: reject SCORE: 20");
    expect(d.recommendation).toBe("reject");
    expect(d.score).toBe(20);
  });
  it("CALL: confirm SCORE: 45 is clamped to caution", () => {
    const d = parseDebate("Looks fine I guess.\nCALL: confirm SCORE: 45");
    expect(d.recommendation).toBe("caution");
  });
});

describe("buildConsensus — a rejecting majority is an outright REJECT", () => {
  const evidence: CouncilEvidence = { bullCount: 1, bearCount: 3, bullPoints: ["x"], bearPoints: ["rug match", "dev sold"], clusterDetected: false, smartMoney: false, devSold: true, rugMatch: true };
  const seat = (id: string, rec: CouncilMemberResult["recommendation"], score: number): CouncilMemberResult =>
    ({ id, label: id, role: "risk_analyst", score, recommendation: rec, rationale: "r", ms: 1 });
  it("3/5 rejects ⇒ consensus reject", () => {
    const c = buildConsensus([seat("a", "reject", 20), seat("b", "reject", 25), seat("c", "reject", 30), seat("d", "caution", 50), seat("e", "confirm", 70)], evidence)!;
    expect(c.recommendation).toBe("reject");
    expect(c.rejectModels).toBe(3);
  });
  it("no rejects keeps the old behaviour (skeptical confirm/caution)", () => {
    const c = buildConsensus([seat("a", "confirm", 70), seat("b", "confirm", 68), seat("c", "caution", 50)], evidence)!;
    expect(c.recommendation).toBe("confirm");
    expect(c.rejectModels).toBe(0);
  });
});
