import { describe, it, expect } from "vitest";
import { evaluateExit, defaultExitPlan, buildFirstSpikeLadder, buildDefaultLadder } from "./exitEngine.js";
import type { Position } from "../types.js";

const MAX_HOLD = 60 * 60 * 1000;

function pos(over: Partial<Position> = {}): Position {
  return {
    id: 1,
    mint: "M",
    symbol: "WIF",
    source: "paper",
    status: "OPEN",
    entryPriceUsd: 1,
    entryAtMs: 0,
    tokenAmount: 1000,
    initialTokenAmount: 1000,
    solInvested: 1,
    costBasisUsd: 150,
    realizedPnlUsd: 0,
    peakPriceUsd: 1,
    lastPriceUsd: 1,
    exitPlan: defaultExitPlan(MAX_HOLD, 0.3, "firstSpike", 1.5, 0),
    ...over,
  };
}

describe("firstSpike exit style", () => {
  it("builds a single-rung full-exit ladder by default", () => {
    const l = buildFirstSpikeLadder(1.5, 0);
    expect(l).toHaveLength(1);
    expect(l[0]!.multiple).toBe(1.5);
    expect(l[0]!.sellPct).toBe(1);
  });

  it("keeps a runner when keepRunnerPct > 0", () => {
    const l = buildFirstSpikeLadder(1.5, 0.1);
    expect(l[0]!.sellPct).toBeCloseTo(0.9, 5);
  });

  it("clamps a degenerate spike multiple up to 1.05", () => {
    const l = buildFirstSpikeLadder(0.5, 0);
    expect(l[0]!.multiple).toBeGreaterThanOrEqual(1.05);
  });

  it("HOLDs below the spike multiple", () => {
    const r = evaluateExit(pos({ peakPriceUsd: 1.4 }), { currentPriceUsd: 1.4, now: 1000 }, { maxHoldMs: MAX_HOLD });
    expect(r.signal.kind).toBe("HOLD");
  });

  it("sells 100% the first time price spikes to the multiple", () => {
    const r = evaluateExit(pos({ peakPriceUsd: 1.5 }), { currentPriceUsd: 1.5, now: 1000 }, { maxHoldMs: MAX_HOLD });
    expect(r.signal.kind).toBe("SELL_TRIM");
    expect(r.signal.sellPct).toBeCloseTo(1, 5);
    expect(r.rungsHit).toEqual([0]);
  });

  it("with a 10% runner, sells 90% at the spike and trail-stops the rest", () => {
    const p = pos({ exitPlan: defaultExitPlan(MAX_HOLD, 0.3, "firstSpike", 1.5, 0.1) });
    const r = evaluateExit(p, { currentPriceUsd: 1.5, now: 1000 }, { maxHoldMs: MAX_HOLD });
    expect(r.signal.kind).toBe("SELL_TRIM");
    expect(r.signal.sellPct).toBeCloseTo(0.9, 5);

    // Mark the rung done + reduce holdings as the engine/caller would, then the
    // runner gives back >30% from peak ⇒ trailing stop exits the remainder.
    p.exitPlan.ladder[0]!.done = true;
    p.tokenAmount = 100;
    p.peakPriceUsd = 2.0;
    const r2 = evaluateExit(p, { currentPriceUsd: 1.3, now: 2000 }, { maxHoldMs: MAX_HOLD });
    expect(r2.signal.kind).toBe("SELL_EXIT_NOW");
    expect(r2.signal.reason).toContain("Trailing stop");
  });

  it("stop-loss and hard exits still beat the spike ladder", () => {
    const r = evaluateExit(pos(), { currentPriceUsd: 0.55, now: 1000 }, { maxHoldMs: MAX_HOLD, stopLossPct: 0.4 });
    expect(r.signal.kind).toBe("SELL_EXIT_NOW");
    expect(r.signal.reason).toContain("Stop loss");

    const h = evaluateExit(pos({ peakPriceUsd: 1.5 }), { currentPriceUsd: 1.5, now: 1000, hard: { devWalletSold: true } }, { maxHoldMs: MAX_HOLD });
    expect(h.signal.kind).toBe("SELL_EXIT_NOW");
    expect(h.signal.hard).toBe(true);
  });

  it("default style is unchanged (early-harvest ladder)", () => {
    const plan = defaultExitPlan(MAX_HOLD);
    expect(plan.ladder).toEqual(buildDefaultLadder());
  });
});
