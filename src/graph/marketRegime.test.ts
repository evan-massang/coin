import { describe, it, expect } from "vitest";
import { classifyRegime } from "./marketRegime.js";

describe("classifyRegime", () => {
  it("risk-off + sharp macro drop ⇒ PANIC", () => {
    const r = classifyRegime({ weather: "RISK_OFF", solChange24h: -9, btcChange24h: -7 });
    expect(r.regime).toBe("PANIC");
    expect(r.confidence).toBeGreaterThan(60);
  });

  it("risk-on + rising macro + buy flow ⇒ BULL_EXPANSION", () => {
    const r = classifyRegime({ weather: "RISK_ON", solChange24h: 6, btcChange24h: 4, buyRate: 0.25 });
    expect(r.regime).toBe("BULL_EXPANSION");
  });

  it("risk-off but only mild drop ⇒ DISTRIBUTION (not PANIC)", () => {
    const r = classifyRegime({ weather: "RISK_OFF", solChange24h: -2 });
    expect(r.regime).toBe("DISTRIBUTION");
  });

  it("calm neutral macro ⇒ ACCUMULATION", () => {
    const r = classifyRegime({ weather: "NEUTRAL", solChange24h: 0.5, btcChange24h: -0.5 });
    expect(r.regime).toBe("ACCUMULATION");
  });

  it("very high avoid rate ⇒ DISTRIBUTION even when flat", () => {
    const r = classifyRegime({ weather: "NEUTRAL", solChange24h: 0, avoidRate: 0.97 });
    expect(r.regime).toBe("DISTRIBUTION");
  });

  it("no macro data ⇒ does not throw, returns a regime + reasons", () => {
    const r = classifyRegime({ weather: "NEUTRAL" });
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(typeof r.confidence).toBe("number");
  });
});
