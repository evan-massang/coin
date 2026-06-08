import { describe, it, expect } from "vitest";
import { convictionContributions, legacyVsAthena } from "./decisionAuthority.js";
import type { ConvictionWeights } from "../scoring/conviction.js";
import type { DecisionThresholds } from "../scoring/decisionCaps.js";
import type { ScoreBreakdown, SafetyResult } from "../types.js";
import { emptyScores } from "../types.js";

const W: ConvictionWeights = { organic: 15, momentum: 30, graduation: 0, devReputation: 0, smartMoney: 0, social: 0, hype: 0, attention: 18 };
const scores = (p: Partial<ScoreBreakdown>): ScoreBreakdown => ({ ...emptyScores(), ...p });
const safety = (): SafetyResult => ({ pass: true, stage: 1, checks: [], unknownCount: 0, fatalReasons: [], score: 80 });
const TH: DecisionThresholds = { minConvictionBuySmall: 55, minConvictionBuyStrong: 72, maxLateEntryRisk: 70, minOrganicScore: 55, weights: W };

describe("convictionContributions (Phase 18)", () => {
  it("contributions sum to the final conviction", () => {
    const b = convictionContributions(scores({ organic: 80, momentum: 60, attention: 90 }), W, { organic: 1, momentum: 1, attention: 1 });
    const sum = b.contributions.reduce((s, c) => s + c.contributionPts, 0);
    expect(sum).toBeCloseTo(b.conviction, 5);
    expect(b.attentionInfluencePct).toBeGreaterThan(20); // attention genuinely contributing
    expect(b.attentionPresentButIgnored).toBe(false);
  });

  it("flags 'attention present but ignored' when it's dropped for low confidence (THE gap)", () => {
    // attention has a real score but confidence 0 ⇒ dropped from the blend ⇒ 0 influence.
    const b = convictionContributions(scores({ organic: 80, momentum: 60, attention: 90 }), W, { organic: 1, momentum: 1, attention: 0 });
    expect(b.attentionInfluencePct).toBe(0);
    expect(b.attentionPresentButIgnored).toBe(true);
    const attn = b.contributions.find((c) => c.facet === "attention")!;
    expect(attn.included).toBe(false);
    expect(attn.contributionPts).toBe(0);
  });
});

describe("legacyVsAthena (Phase 22)", () => {
  it("shows attention FLIPPING a verdict (WATCH→BUY) when it counts", () => {
    const input = { mint: "M", at: 0, scores: scores({ organic: 50, momentum: 50, attention: 100 }), safety: safety(), thresholds: TH, confidence: { organic: 1, momentum: 1, attention: 1 } };
    const r = legacyVsAthena(input);
    expect(r.legacy.verdict).toBe("WATCH_ONLY"); // without attention, below the 55 gate
    expect(["BUY_SMALL", "BUY_STRONG"]).toContain(r.athena.verdict); // attention pushes it over
    expect(r.diverged).toBe(true);
    expect(r.convictionDelta).toBeGreaterThan(0);
  });

  it("does NOT diverge when attention is dropped (confidence 0) — the watching-only case", () => {
    const input = { mint: "M", at: 0, scores: scores({ organic: 50, momentum: 50, attention: 100 }), safety: safety(), thresholds: TH, confidence: { organic: 1, momentum: 1, attention: 0 } };
    const r = legacyVsAthena(input);
    expect(r.diverged).toBe(false); // attention present but ignored ⇒ identical to legacy
  });
});
