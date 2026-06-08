import { describe, it, expect } from "vitest";
import { lateEntryRisk } from "./lateEntry.js";

describe("lateEntryRisk — DexScreener run-up wiring (the FREE signal the guard was missing)", () => {
  it("an empty/blind input produces a LOW risk that cannot reach the default 70 gate", () => {
    // This is the pre-fix live reality: the trade buffer was empty, so the guard
    // saw no run-up and never fired. Risk stays well below the 70 threshold.
    const r = lateEntryRisk({});
    expect(r.risk).toBeLessThan(70);
  });

  it("a fresh m5 spike adds blow-off-top risk (we'd be buying the local top)", () => {
    const calm = lateEntryRisk({ recentPriceChangeM5Pct: 5 });
    const spike = lateEntryRisk({ recentPriceChangeM5Pct: 120 });
    expect(spike.risk).toBeGreaterThan(calm.risk);
    expect(spike.risk).toBeGreaterThanOrEqual(30);
    expect(spike.reasons.join(" ")).toMatch(/blow-off/i);
  });

  it("a sharp m5 drop adds falling-knife risk (buying into an active dump)", () => {
    const knife = lateEntryRisk({ recentPriceChangeM5Pct: -40 });
    expect(knife.risk).toBeGreaterThanOrEqual(22);
    expect(knife.reasons.join(" ")).toMatch(/falling knife/i);
  });

  it("a mild positive m5 (healthy momentum) does NOT inflate risk", () => {
    const healthy = lateEntryRisk({ recentPriceChangeM5Pct: 10 });
    expect(healthy.risk).toBe(0);
  });

  it("combined run-up signals can push risk past the 70 enforcement gate", () => {
    // price already +200% since first seen + a fresh m5 blow-off + huge h1 run.
    const r = lateEntryRisk({
      priceGainPctSinceFirstSeen: 200,
      recentPriceChangeM5Pct: 120,
      recentPriceChangeH1Pct: 600,
    });
    expect(r.risk).toBeGreaterThan(70);
  });

  it("risk is clamped to 0..100", () => {
    const r = lateEntryRisk({
      priceGainPctSinceFirstSeen: 9999,
      bondingCurveProgress: 1,
      buyerVelocityTrend: -1,
      pullbackSeen: false,
      smartMoneyEntryDiscountPct: 99,
      estimatedSlippagePct: 99,
      recentPriceChangeM5Pct: 999,
      recentPriceChangeH1Pct: 9999,
    });
    expect(r.risk).toBeLessThanOrEqual(100);
    expect(r.risk).toBeGreaterThanOrEqual(0);
  });
});
