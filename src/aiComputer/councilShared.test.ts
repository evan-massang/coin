import { describe, it, expect } from "vitest";
import { parseVerdict, buildEvidencePrompt, buildSystemPrompt, parseDebate } from "./councilShared.js";

describe("parseVerdict", () => {
  it("extracts JSON even with surrounding chatter", () => {
    expect(parseVerdict('sure: {"score": 80, "recommendation":"confirm","rationale":"clean"} done')).toEqual({
      score: 80, recommendation: "confirm", rationale: "clean",
    });
  });
  it("clamps score and defaults bad fields (score is authoritative for the verdict)", () => {
    const v = parseVerdict('{"score": 250, "recommendation":"maybe"}')!;
    expect(v.score).toBe(100);
    // Unknown verdict defaults to caution, then the consistency clamp promotes a
    // 100-score to confirm — the SCORE decides, never free text (teardown fix).
    expect(v.recommendation).toBe("confirm");
    expect(v.rationale).toBe("no rationale");
  });
  it("non-JSON ⇒ undefined", () => {
    expect(parseVerdict("no json here")).toBeUndefined();
  });
});

describe("buildEvidencePrompt", () => {
  it("carries interpreted signals, NOT raw chain data", () => {
    const p = buildEvidencePrompt({
      symbol: "X", bullCount: 3, bearCount: 1, bullPoints: ["smart money entered"], bearPoints: ["thin liquidity"],
      clusterDetected: true, smartMoney: true, devSold: false, rugMatch: false, marketRegime: "ACCUMULATION",
    });
    expect(p).toContain("bull_evidence_count: 3");
    expect(p).toContain("smart money entered");
    expect(p).toContain("market_regime: ACCUMULATION");
    // no raw blockchain primitives leak through
    expect(p).not.toMatch(/holders:|liquidity_usd|topHolder|"liquidity"/i);
  });
});

describe("parseDebate", () => {
  it("reads the CALL/SCORE line + keeps the spoken text", () => {
    const d = parseDebate("I concur with Llama — momentum is real.\nCALL: confirm SCORE: 82");
    expect(d.recommendation).toBe("confirm");
    expect(d.score).toBe(82);
    expect(d.text).toContain("I concur with Llama");
    expect(d.text).not.toMatch(/CALL:/);
  });
  it("falls back to JSON when a model ignores the CALL format", () => {
    const d = parseDebate('Thin liquidity worries me. {"score":40,"recommendation":"caution","rationale":"risk"}');
    expect(d.recommendation).toBe("caution");
    expect(d.score).toBe(40);
    expect(d.text).toContain("Thin liquidity");
    expect(d.text).not.toMatch(/\{/);
  });
});

describe("buildSystemPrompt", () => {
  it("embeds the seat's role as an EVIDENCE job, not a conclusion to perform", () => {
    expect(buildSystemPrompt("risk_analyst")).toContain("FAILURE-MODE evidence");
    expect(buildSystemPrompt("contrarian")).toContain("attacks the bull case");
    // Every seat must be free to reject (the old council had 0 rejects in 5,543).
    expect(buildSystemPrompt("bull_analyst")).toMatch(/reject/i);
  });
  it("forbids trading + tool use (read-only, advisory)", () => {
    const s = buildSystemPrompt("bull_analyst");
    expect(s).toMatch(/cannot place trades/i);
    expect(s).toMatch(/do not call any tools/i);
  });
});
