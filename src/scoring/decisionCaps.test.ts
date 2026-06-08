import { describe, it, expect } from "vitest";
import { decide, type DecisionThresholds } from "./decisionCaps.js";
import type { ScoreBreakdown, SafetyResult } from "../types.js";
import { emptyScores } from "../types.js";

const THRESHOLDS: DecisionThresholds = {
  minConvictionBuySmall: 55,
  minConvictionBuyStrong: 72,
  maxLateEntryRisk: 70,
  minOrganicScore: 55,
  weights: {
    organic: 15,
    momentum: 30,
    graduation: 12,
    devReputation: 12,
    smartMoney: 18,
    social: 8,
    hype: 5,
  },
};

function safety(pass: boolean, unknownCount = 0, fatalReasons: string[] = []): SafetyResult {
  return {
    pass,
    stage: 1,
    checks: [],
    unknownCount,
    fatalReasons,
    score: pass ? 80 : 0,
  };
}

function scores(p: Partial<ScoreBreakdown>): ScoreBreakdown {
  return { ...emptyScores(), ...p };
}

const at = 1_000;

describe("decide() — confidence-aware coverage (Cycle 1 fix)", () => {
  // organic shows the "insufficient" placeholder 45 (≥30 so no AVOID) but is UNKNOWN.
  it("low real-coverage caps to WATCH even with high nominal scores (the 5-sniper case)", () => {
    const d = decide({
      mint: "M", at,
      scores: scores({ organic: 45, momentum: 100, smartMoney: 100, hype: 80 }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      confidence: { organic: 0, momentum: 0, graduation: 0, devReputation: 0, smartMoney: 0, social: 0, hype: 1 },
    });
    expect(d.conviction).toBeLessThanOrEqual(49);
    expect(d.verdict).not.toBe("BUY_SMALL");
    expect(d.verdict).not.toBe("BUY_STRONG");
    expect(d.flags).toContain("low-coverage");
  });

  it("social + hype alone cannot clear the gate", () => {
    const d = decide({
      mint: "M", at,
      scores: scores({ organic: 45, social: 100, hype: 100 }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      confidence: { organic: 0, momentum: 0, graduation: 0, devReputation: 0, smartMoney: 0, social: 1, hype: 1 },
    });
    expect(d.conviction).toBeLessThanOrEqual(49);
  });

  it("a full-coverage active vector (organic+momentum confident) CAN reach BUY", () => {
    const d = decide({
      mint: "M", at,
      scores: scores({ organic: 80, momentum: 85, graduation: 60, hype: 56 }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      confidence: { organic: 0.9, momentum: 0.9, graduation: 0.8, devReputation: 0, smartMoney: 0, social: 0, hype: 0.6 },
    });
    expect(d.conviction).toBeGreaterThanOrEqual(55);
    expect(["BUY_SMALL", "BUY_STRONG"]).toContain(d.verdict);
  });

  it("absent confidence ⇒ legacy behaviour (no low-coverage cap)", () => {
    const d = decide({ mint: "M", at, scores: scores({ organic: 80, momentum: 85, graduation: 60, smartMoney: 70, hype: 56 }), safety: safety(true), thresholds: THRESHOLDS });
    expect(d.flags).not.toContain("low-coverage");
    expect(["BUY_SMALL", "BUY_STRONG"]).toContain(d.verdict);
  });
});

describe("decide() — gate → score → cap → verdict", () => {
  it("safety fail ⇒ AVOID even with a perfect score everywhere (incl. hype)", () => {
    const d = decide({
      mint: "M",
      scores: scores({
        organic: 100,
        momentum: 100,
        graduation: 100,
        devReputation: 100,
        smartMoney: 100,
        social: 100,
        hype: 100,
        lateEntryRisk: 0,
      }),
      safety: safety(false, 0, ["mint authority not revoked"]),
      thresholds: THRESHOLDS,
      at,
    });
    expect(d.verdict).toBe("AVOID");
    expect(d.conviction).toBe(0);
    expect(d.reasons[0]).toMatch(/safety gate failed/i);
  });

  it("clean strong setup ⇒ BUY_STRONG", () => {
    const d = decide({
      mint: "M",
      scores: scores({
        organic: 80,
        momentum: 90,
        graduation: 80,
        devReputation: 80,
        smartMoney: 85,
        social: 70,
        hype: 60,
        lateEntryRisk: 10,
      }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      at,
    });
    expect(d.verdict).toBe("BUY_STRONG");
    expect(d.conviction).toBeGreaterThanOrEqual(72);
  });

  it("organic < 30 ⇒ AVOID (hard wash-volume floor)", () => {
    const d = decide({
      mint: "M",
      scores: scores({ organic: 20, momentum: 95, smartMoney: 95, graduation: 90 }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      at,
    });
    expect(d.verdict).toBe("AVOID");
    expect(d.flags).toContain("wash-volume");
  });

  it("organic in [30,45) caps conviction to WATCH band ⇒ WATCH_ONLY", () => {
    const d = decide({
      mint: "M",
      scores: scores({ organic: 40, momentum: 95, smartMoney: 95, graduation: 90, devReputation: 90 }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      at,
    });
    expect(d.verdict).toBe("WATCH_ONLY");
    expect(d.conviction).toBeLessThanOrEqual(49);
    expect(d.caps.some((c) => c.includes("organic"))).toBe(true);
  });

  it("lateEntryRisk above max ⇒ TOO_LATE (entry gone even if signal is right)", () => {
    const d = decide({
      mint: "M",
      scores: scores({
        organic: 70,
        momentum: 90,
        smartMoney: 90,
        graduation: 85,
        devReputation: 80,
        lateEntryRisk: 80,
      }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      at,
    });
    expect(d.verdict).toBe("TOO_LATE");
    expect(d.caps).toContain("lateEntry⇒TOO_LATE");
  });

  it("SHADOW mode: high lateEntryRisk flags 'would block' but does NOT change the verdict", () => {
    // The guard now reads the FREE DexScreener run-up, but ships in shadow until
    // forward data calibrates the threshold (winners dip before they rip).
    const strong = {
      organic: 70, momentum: 90, smartMoney: 90, graduation: 85, devReputation: 80, lateEntryRisk: 80,
    };
    const shadow = decide({
      mint: "M", at,
      scores: scores(strong),
      safety: safety(true),
      thresholds: { ...THRESHOLDS, lateEntryEnforce: false },
    });
    expect(shadow.verdict).not.toBe("TOO_LATE");
    expect(["BUY_SMALL", "BUY_STRONG"]).toContain(shadow.verdict);
    expect(shadow.flags).toContain("late-entry-shadow");
    expect(shadow.caps.some((c) => c.includes("shadow"))).toBe(true);
    // Same setup WITH enforcement ⇒ blocked, as before.
    const enforced = decide({
      mint: "M", at,
      scores: scores(strong),
      safety: safety(true),
      thresholds: { ...THRESHOLDS, lateEntryEnforce: true },
    });
    expect(enforced.verdict).toBe("TOO_LATE");
  });

  it("≥2 UNKNOWN safety items flags but no longer CAPS conviction (Cycle 7)", () => {
    // On the free feed safety unknowns are structural/permanent; they pegged every
    // BUY at 59 and made BUY_STRONG unreachable. They now flag (transparency) but
    // don't cap — a strong clean-gate vector can reach BUY_STRONG. Protection lives
    // in the gate + LOW_COVERAGE_CAP + risk sizing, not a conviction ceiling.
    const d = decide({
      mint: "M",
      scores: scores({
        organic: 75,
        momentum: 95,
        smartMoney: 95,
        graduation: 90,
        devReputation: 90,
        social: 80,
        hype: 80,
      }),
      safety: safety(true, 2),
      thresholds: THRESHOLDS,
      at,
    });
    expect(d.flags).toContain("safety-unknowns"); // still surfaced for transparency
    expect(d.conviction).toBeGreaterThan(59); // no longer pegged at 59
    expect(d.verdict).toBe("BUY_STRONG"); // strong vector can now reach it
  });

  it("momentum floor holds a would-be BUY to WATCH when momentum < floor (Cycle 7 edge)", () => {
    const strong = {
      organic: 80, momentum: 70, graduation: 80, devReputation: 80, smartMoney: 85, social: 70, hype: 60, lateEntryRisk: 10,
    };
    // No floor ⇒ this strong vector BUYs.
    const noFloor = decide({ mint: "M", at, scores: scores(strong), safety: safety(true), thresholds: THRESHOLDS });
    expect(["BUY_SMALL", "BUY_STRONG"]).toContain(noFloor.verdict);
    // Floor 85 with momentum 70 ⇒ held to WATCH, flagged.
    const floored = decide({ mint: "M", at, scores: scores(strong), safety: safety(true), thresholds: { ...THRESHOLDS, minMomentumForBuy: 85 } });
    expect(floored.verdict).toBe("WATCH_ONLY");
    expect(floored.flags).toContain("low-momentum");
    // Floor 85 with momentum 90 ⇒ still BUYs (above the floor).
    const passes = decide({ mint: "M", at, scores: scores({ ...strong, momentum: 90 }), safety: safety(true), thresholds: { ...THRESHOLDS, minMomentumForBuy: 85 } });
    expect(["BUY_SMALL", "BUY_STRONG"]).toContain(passes.verdict);
  });

  it("momentum CEILING holds a hot-momentum would-be BUY to WATCH (Cycle 8 — anti-chase)", () => {
    const strong = {
      organic: 80, momentum: 90, graduation: 80, devReputation: 80, smartMoney: 85, social: 70, hype: 60, lateEntryRisk: 10,
    };
    // No ceiling ⇒ this strong vector BUYs.
    const noCeil = decide({ mint: "M", at, scores: scores(strong), safety: safety(true), thresholds: THRESHOLDS });
    expect(["BUY_SMALL", "BUY_STRONG"]).toContain(noCeil.verdict);
    // Ceiling 70 with momentum 90 ⇒ held to WATCH, flagged as a chase.
    const capped = decide({ mint: "M", at, scores: scores(strong), safety: safety(true), thresholds: { ...THRESHOLDS, maxMomentumForBuy: 70 } });
    expect(capped.verdict).toBe("WATCH_ONLY");
    expect(capped.flags).toContain("high-momentum-chase");
    // Ceiling 70 with momentum 55 ⇒ still BUYs (below the ceiling).
    const ok = decide({ mint: "M", at, scores: scores({ ...strong, momentum: 55 }), safety: safety(true), thresholds: { ...THRESHOLDS, maxMomentumForBuy: 70 } });
    expect(["BUY_SMALL", "BUY_STRONG"]).toContain(ok.verdict);
  });

  it("AI hype alone cannot force a BUY (small weight by design)", () => {
    const d = decide({
      mint: "M",
      // Everything dead except a maxed AI hype; organic just above the floor.
      scores: scores({ organic: 46, hype: 100 }),
      safety: safety(true),
      thresholds: THRESHOLDS,
      at,
    });
    expect(d.verdict).toBe("AVOID");
    expect(d.conviction).toBeLessThan(THRESHOLDS.minConvictionBuySmall);
  });
});
