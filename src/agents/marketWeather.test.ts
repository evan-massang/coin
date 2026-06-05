import { describe, it, expect } from "vitest";
import { computeMarketWeather } from "./marketWeather.js";

const RISK_OFF = 0.35;

describe("computeMarketWeather", () => {
  it("bullish macro ⇒ RISK_ON (×1.2)", () => {
    const r = computeMarketWeather({ solChange24h: 8, btcChange24h: 5, riskOffMultiplier: RISK_OFF });
    expect(r.weather).toBe("RISK_ON");
    expect(r.multiplier).toBe(1.2);
  });

  it("bearish macro ⇒ RISK_OFF (× riskOffMultiplier)", () => {
    const r = computeMarketWeather({ solChange24h: -9, btcChange24h: -6, riskOffMultiplier: RISK_OFF });
    expect(r.weather).toBe("RISK_OFF");
    expect(r.multiplier).toBe(RISK_OFF);
  });

  it("flat macro ⇒ NEUTRAL (×1.0)", () => {
    const r = computeMarketWeather({ solChange24h: 0.5, btcChange24h: -0.5, riskOffMultiplier: RISK_OFF });
    expect(r.weather).toBe("NEUTRAL");
    expect(r.multiplier).toBe(1);
  });

  it("internal win rate is weighted higher than macro", () => {
    // Bullish macro but the engine itself is losing badly ⇒ net bearish.
    const r = computeMarketWeather({
      solChange24h: 8,
      btcChange24h: 8,
      internalWinRate: 0.2,
      internalSamples: 50,
      riskOffMultiplier: RISK_OFF,
    });
    expect(r.weather).toBe("RISK_OFF");
  });

  // ── Cold-start guard (Cycle 5): a tiny/zero traded sample must NOT poison
  // weather into a permanent false RISK_OFF that floors every BUY to TINY. ──
  it("cold start: a tiny losing sample is ignored ⇒ stays NEUTRAL (macro-only)", () => {
    const r = computeMarketWeather({
      solChange24h: 0.5,
      btcChange24h: -0.5,
      internalWinRate: 0, // 0% over a handful of resolved BUYs
      internalSamples: 5, // below the default 20-sample gate
      riskOffMultiplier: RISK_OFF,
    });
    expect(r.weather).toBe("NEUTRAL");
    expect(r.multiplier).toBe(1);
  });

  it("cold start: bullish macro survives a tiny losing sample ⇒ RISK_ON", () => {
    // Previously a ~0% all-signal win rate would override good macro and force
    // RISK_OFF. With the cold-start guard, macro wins until there's real data.
    const r = computeMarketWeather({
      solChange24h: 8,
      btcChange24h: 8,
      internalWinRate: 0,
      internalSamples: 3,
      riskOffMultiplier: RISK_OFF,
    });
    expect(r.weather).toBe("RISK_ON");
  });

  it("brake re-engages once there are enough REAL resolved trades", () => {
    // At/above the sample gate a genuinely losing engine SHOULD go RISK_OFF.
    const r = computeMarketWeather({
      solChange24h: 8,
      btcChange24h: 8,
      internalWinRate: 0.1,
      internalSamples: 20, // exactly the default gate
      riskOffMultiplier: RISK_OFF,
    });
    expect(r.weather).toBe("RISK_OFF");
  });

  it("honours a custom minInternalSamples threshold", () => {
    const base = { solChange24h: 0, internalWinRate: 0.1, riskOffMultiplier: RISK_OFF } as const;
    // 15 samples: below a strict 30-gate ⇒ ignored (NEUTRAL); above the default 20? no, 15<20.
    expect(computeMarketWeather({ ...base, internalSamples: 15, minInternalSamples: 30 }).weather).toBe("NEUTRAL");
    // 15 samples with a loose 10-gate ⇒ counted ⇒ RISK_OFF.
    expect(computeMarketWeather({ ...base, internalSamples: 15, minInternalSamples: 10 }).weather).toBe("RISK_OFF");
  });
});
