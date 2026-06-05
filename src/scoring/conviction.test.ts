import { describe, it, expect } from "vitest";
import { computeConviction, realCoverage, clamp, type ConvictionWeights } from "./conviction.js";
import { emptyScores } from "../types.js";

const W: ConvictionWeights = {
  organic: 15,
  momentum: 30,
  graduation: 12,
  devReputation: 12,
  smartMoney: 18,
  social: 8,
  hype: 5,
};

describe("computeConviction", () => {
  it("is a weighted average of non-gate sub-scores", () => {
    const c = computeConviction(
      { ...emptyScores(), organic: 80, momentum: 90, graduation: 80, devReputation: 80, smartMoney: 85, social: 70, hype: 60 },
      W,
    );
    // (80*15+90*30+80*12+80*12+85*18+70*8+60*5)/100 = 82.1
    expect(c).toBeCloseTo(82.1, 1);
  });

  it("bounds hype: maxed hype with everything else zero stays low", () => {
    const c = computeConviction({ ...emptyScores(), hype: 100 }, W);
    expect(c).toBeCloseTo(5, 0); // weightHype / totalWeight = 5/100 * 100
    expect(c).toBeLessThan(10);
  });

  it("zero total weight ⇒ 0 (never divides by zero)", () => {
    const zeroW: ConvictionWeights = { organic: 0, momentum: 0, graduation: 0, devReputation: 0, smartMoney: 0, social: 0, hype: 0 };
    expect(computeConviction({ ...emptyScores(), momentum: 100 }, zeroW)).toBe(0);
  });

  it("clamp keeps values in range", () => {
    expect(clamp(150)).toBe(100);
    expect(clamp(-5)).toBe(0);
    expect(clamp(50)).toBe(50);
  });

  it("absent confidence ⇒ identical to legacy (every facet trusted)", () => {
    const sc = { ...emptyScores(), organic: 80, momentum: 90, smartMoney: 85 };
    expect(computeConviction(sc, W)).toBe(computeConviction(sc, W, {}, 0.5));
  });

  it("excludes facets below the confidence floor from BOTH numerator and denominator", () => {
    const sc = { ...emptyScores(), organic: 88, momentum: 10 };
    // only organic confident; momentum (low conf) and absent others (set to 0) are dropped
    const conf = { organic: 0.9, momentum: 0.2, graduation: 0, devReputation: 0, smartMoney: 0, social: 0, hype: 0 };
    expect(computeConviction(sc, W, conf, 0.5)).toBe(88); // organic alone — not dragged by momentum=10
  });
});

describe("realCoverage (Cycle 1 fix)", () => {
  it("is 1 when all real facets are confident, 0 when none are", () => {
    expect(realCoverage(W, {}, 0.5)).toBe(1);
    expect(realCoverage(W, { organic: 0, momentum: 0, graduation: 0, devReputation: 0, smartMoney: 0 }, 0.5)).toBe(0);
  });
  it("EXCLUDES social + hype — they alone cannot lift coverage", () => {
    // only the narrative anchors are confident; every real facet is unknown ⇒ 0 coverage
    expect(realCoverage(W, { organic: 0, momentum: 0, graduation: 0, devReputation: 0, smartMoney: 0, social: 1, hype: 1 }, 0.5)).toBe(0);
  });
  it("organic+momentum confident ⇒ just over half (45/87)", () => {
    expect(realCoverage(W, { organic: 0.9, momentum: 0.9, graduation: 0, devReputation: 0, smartMoney: 0 }, 0.5)).toBeCloseTo((15 + 30) / (15 + 30 + 12 + 12 + 18), 3);
  });
});
