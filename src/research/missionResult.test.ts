import { describe, it, expect } from "vitest";
import { resultToScores, resultToRecord } from "./missionResult.js";

describe("resultToScores — domain clamping (red-team fix)", () => {
  it("clamps hostile sub-scores to 0..100 (1e9 cannot reach the graveyard)", () => {
    const s = resultToScores({ recommendation: "confirm", confidence: 80, scores: { attention: 1e9, humanity: -50, virality: 250 } });
    expect(s.attention).toBe(100);
    expect(s.humanity).toBe(0);
    expect(s.virality).toBe(100);
  });

  it("clamps confidence to 0..1 even for absurd inputs", () => {
    expect(resultToScores({ recommendation: "confirm", confidence: 1e9 }).confidence).toBe(1);
    expect(resultToScores({ recommendation: "confirm", confidence: -5 }).confidence).toBe(0);
  });

  it("non-numeric sub-scores fall back to the recommendation base, never NaN", () => {
    const s = resultToScores({ recommendation: "avoid", confidence: 50, scores: { attention: "evil" as unknown as number } });
    expect(s.attention).toBe(12); // avoid → base 12
    expect(Number.isFinite(s.humanity)).toBe(true);
  });

  it("maps recommendation → base attention (confirm 78 / caution 45 / unsure 35 / avoid 12)", () => {
    expect(resultToScores({ recommendation: "confirm", confidence: 50 }).attention).toBe(78);
    expect(resultToScores({ recommendation: "caution", confidence: 50 }).attention).toBe(45);
    expect(resultToScores({ recommendation: "unsure", confidence: 50 }).attention).toBe(35);
    expect(resultToScores({ recommendation: "avoid", confidence: 50 }).attention).toBe(12);
  });
});

describe("resultToRecord", () => {
  it("carries provider provenance into the record source", () => {
    const r = resultToRecord("M", "DOGE", { recommendation: "confirm", confidence: 70, provider: "manus" }, 123);
    expect(r.source).toBe("manus");
    expect(r.mint).toBe("M");
    expect(r.at).toBe(123);
    expect(r.evidence.symbol).toBe("DOGE");
  });
});
