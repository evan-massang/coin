import { describe, it, expect } from "vitest";
import { sizePaperBuy, type PaperRiskInputs } from "./paperRiskManager.js";

function base(over: Partial<PaperRiskInputs> = {}): PaperRiskInputs {
  return {
    verdict: "BUY_SMALL",
    balanceSol: 10,
    maxPositionSol: 1,
    riskPerTradePct: 5,
    safetyPass: true,
    organicScore: 70,
    minOrganicScore: 55,
    lateEntryRisk: 20,
    maxLateEntryRisk: 70,
    liquidityUsd: 20000,
    minLiquidityUsd: 3000,
    ...over,
  };
}

describe("sizePaperBuy", () => {
  it("BUY_SMALL sizes within 1–2% of the wallet", () => {
    const r = sizePaperBuy(base({ verdict: "BUY_SMALL", balanceSol: 10 }));
    expect(r.buy).toBe(true);
    expect(r.sizeSol / 10).toBeGreaterThanOrEqual(0.01);
    expect(r.sizeSol / 10).toBeLessThanOrEqual(0.02);
  });

  it("BUY_STRONG sizes within 3–5% of the wallet", () => {
    const r = sizePaperBuy(base({ verdict: "BUY_STRONG", balanceSol: 10, maxPositionSol: 5 }));
    expect(r.buy).toBe(true);
    expect(r.sizeSol / 10).toBeGreaterThanOrEqual(0.03);
    expect(r.sizeSol / 10).toBeLessThanOrEqual(0.05);
  });

  it("does not buy on a non-BUY verdict", () => {
    expect(sizePaperBuy(base({ verdict: "TOO_LATE" })).buy).toBe(false);
    expect(sizePaperBuy(base({ verdict: "WATCH_ONLY" })).buy).toBe(false);
  });

  it("does not buy when safety failed", () => {
    expect(sizePaperBuy(base({ safetyPass: false })).buy).toBe(false);
  });

  it("does not buy on thin liquidity", () => {
    const r = sizePaperBuy(base({ liquidityUsd: 500 }));
    expect(r.buy).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/liquidity/i);
  });

  it("does not buy when late-entry risk is too high or organic too low", () => {
    expect(sizePaperBuy(base({ lateEntryRisk: 90 })).buy).toBe(false);
    expect(sizePaperBuy(base({ organicScore: 40 })).buy).toBe(false);
  });

  it("respects Max Position Size SOL", () => {
    const r = sizePaperBuy(base({ verdict: "BUY_STRONG", balanceSol: 100, maxPositionSol: 0.5 }));
    expect(r.sizeSol).toBeLessThanOrEqual(0.5);
  });

  it("respects Risk Per Trade %", () => {
    // 1% risk cap on a 10 SOL wallet ⇒ ≤0.1 SOL even for BUY_STRONG.
    const r = sizePaperBuy(base({ verdict: "BUY_STRONG", balanceSol: 10, maxPositionSol: 5, riskPerTradePct: 1 }));
    expect(r.sizeSol).toBeLessThanOrEqual(0.1 + 1e-9);
  });
});
