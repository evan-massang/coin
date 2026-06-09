import { describe, it, expect } from "vitest";
import { decide, type DecisionThresholds } from "./decisionCaps.js";
import type { ScoreBreakdown, SafetyResult } from "../types.js";
import { emptyScores } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Hermes Phase 1/4 invariant guard: a research PROVIDER (local Athena, the manual
// mission board, or a remote Manus API) is ADVISORY by construction. Its result
// only ever lands as the `attention` facet + confidence and is fed back through
// decide(), which runs the HARD SAFETY GATE FIRST. These tests pin that a maxed
// provider read can never override safety, breach the organic floor, or force a
// BUY past the coverage/conviction gates — no matter how confident it is.
// ─────────────────────────────────────────────────────────────────────────────

const THRESHOLDS: DecisionThresholds = {
  minConvictionBuySmall: 55,
  minConvictionBuyStrong: 72,
  maxLateEntryRisk: 70,
  minOrganicScore: 55,
  weights: { organic: 15, momentum: 30, graduation: 12, devReputation: 12, smartMoney: 18, social: 8, hype: 5, attention: 18 },
};

function safety(pass: boolean, fatalReasons: string[] = []): SafetyResult {
  return { pass, stage: 1, checks: [], unknownCount: 0, fatalReasons, score: pass ? 80 : 0 };
}
function scores(p: Partial<ScoreBreakdown>): ScoreBreakdown {
  return { ...emptyScores(), ...p };
}
const at = 1_000;

describe("decide() — provider (Manus/attention) is advisory, never authoritative", () => {
  it("a maxed provider read CANNOT override a failed safety gate ⇒ AVOID", () => {
    const d = decide({
      mint: "M", at,
      scores: scores({ organic: 100, momentum: 100, graduation: 100, devReputation: 100, smartMoney: 100, social: 100, hype: 100, attention: 100 }),
      safety: safety(false, ["mint authority not revoked"]),
      thresholds: { ...THRESHOLDS, attentionReadinessGate: true },
      confidence: { organic: 1, momentum: 1, graduation: 1, devReputation: 1, smartMoney: 1, social: 1, hype: 1, attention: 1 },
      attentionResearched: true,
    });
    expect(d.verdict).toBe("AVOID");
    expect(d.conviction).toBe(0);
  });

  it("a high-attention provider result still respects the organic hard floor ⇒ AVOID", () => {
    const d = decide({
      mint: "M", at,
      scores: scores({ organic: 20, momentum: 95, attention: 100 }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      confidence: { organic: 1, momentum: 1, attention: 1 },
    });
    expect(d.verdict).toBe("AVOID");
    expect(d.flags).toContain("wash-volume");
  });

  it("attention alone cannot force a BUY when the REAL-evidence facets are blind (low-coverage cap holds)", () => {
    // Every real facet is UNKNOWN; only a maxed, fully-confident attention read.
    // The low-coverage cap must hold this below the BUY gate — a provider cannot
    // buy a coin we have no real on-chain/market evidence for.
    const d = decide({
      mint: "M", at,
      scores: scores({ organic: 46, attention: 100 }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      confidence: { organic: 0, momentum: 0, graduation: 0, devReputation: 0, smartMoney: 0, social: 0, hype: 0, attention: 1 },
    });
    expect(["BUY_SMALL", "BUY_STRONG"]).not.toContain(d.verdict);
    expect(d.conviction).toBeLessThanOrEqual(49);
    expect(d.flags).toContain("low-coverage");
  });

  it("readiness gate: a would-be BUY is HELD at WATCH until a provider has actually researched it", () => {
    const strong = { organic: 80, momentum: 90, graduation: 80, devReputation: 80, smartMoney: 85, social: 70, hype: 60, lateEntryRisk: 10 };
    const held = decide({
      mint: "M", at,
      scores: scores(strong),
      safety: safety(true),
      thresholds: { ...THRESHOLDS, attentionReadinessGate: true },
      attentionResearched: false,
    });
    expect(held.verdict).toBe("WATCH_ONLY");
    expect(held.flags).toContain("awaiting-attention");
  });
});
