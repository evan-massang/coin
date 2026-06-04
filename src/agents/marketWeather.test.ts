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
});
