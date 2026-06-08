import { describe, it, expect } from "vitest";
import { evaluateExit, defaultExitPlan } from "./exitEngine.js";
import type { Position } from "../types.js";

const MAX_HOLD = 60 * 60 * 1000;

function pos(over: Partial<Position> = {}): Position {
  return {
    id: 1,
    mint: "M",
    symbol: "WIF",
    source: "wallet",
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
    exitPlan: defaultExitPlan(MAX_HOLD),
    ...over,
  };
}

describe("evaluateExit", () => {
  it("HOLDs below the first rung with no danger signals", () => {
    // First early-harvest rung is now 1.4x; 1.3x is below it with no drop ⇒ HOLD.
    const r = evaluateExit(pos({ peakPriceUsd: 1.3 }), { currentPriceUsd: 1.3, now: 1000 }, { maxHoldMs: MAX_HOLD });
    expect(r.signal.kind).toBe("HOLD");
  });

  it("fires the first early-harvest rung as SELL_TRIM (~30% at 1.4x)", () => {
    const r = evaluateExit(pos({ peakPriceUsd: 1.4 }), { currentPriceUsd: 1.4, now: 1000 }, { maxHoldMs: MAX_HOLD });
    expect(r.signal.kind).toBe("SELL_TRIM");
    expect(r.signal.sellPct).toBeCloseTo(0.3, 2);
    expect(r.rungsHit).toEqual([0]);
  });

  it("hits multiple early-harvest rungs at once on a jump to 2.5x (30+30+20%)", () => {
    const r = evaluateExit(pos({ peakPriceUsd: 2.5 }), { currentPriceUsd: 2.5, now: 1000 }, { maxHoldMs: MAX_HOLD });
    expect(r.signal.kind).toBe("SELL_TRIM");
    expect(r.signal.sellPct).toBeCloseTo(0.8, 2);
    expect(r.rungsHit).toEqual([0, 1, 2]);
  });

  it("HARD EXIT beats the profit ladder (dev sold at 2x ⇒ SELL_EXIT_NOW 100%)", () => {
    const r = evaluateExit(
      pos({ peakPriceUsd: 2 }),
      { currentPriceUsd: 2, now: 1000, hard: { devWalletSold: true } },
      { maxHoldMs: MAX_HOLD },
    );
    expect(r.signal.kind).toBe("SELL_EXIT_NOW");
    expect(r.signal.sellPct).toBe(1);
    expect(r.signal.hard).toBe(true);
    expect(r.rungsHit).toEqual([]); // ladder never consulted
  });

  it("distribution / top-holder dump triggers a hard exit", () => {
    const r = evaluateExit(
      pos({ peakPriceUsd: 1.2 }),
      { currentPriceUsd: 1.2, now: 1000, hard: { topHolderDumping: true } },
      { maxHoldMs: MAX_HOLD },
    );
    expect(r.signal.kind).toBe("SELL_EXIT_NOW");
    expect(r.signal.hard).toBe(true);
  });

  it("trailing stop locks gains after a run-up (−35% from peak)", () => {
    const r = evaluateExit(
      pos({ peakPriceUsd: 5, exitPlan: defaultExitPlan(MAX_HOLD, 0.35) }),
      { currentPriceUsd: 3, now: 1000 }, // 40% off the 5x peak, still 3x
      { maxHoldMs: MAX_HOLD },
    );
    expect(r.signal.kind).toBe("SELL_EXIT_NOW");
    expect(r.signal.reason).toMatch(/trailing/i);
  });

  it("stop-loss cuts a loser fast (down 50% ⇒ SELL_EXIT_NOW)", () => {
    const r = evaluateExit(
      pos({ peakPriceUsd: 1.1, entryPriceUsd: 1 }),
      { currentPriceUsd: 0.5, now: 1000 }, // 50% below entry
      { maxHoldMs: MAX_HOLD, stopLossPct: 0.45 },
    );
    expect(r.signal.kind).toBe("SELL_EXIT_NOW");
    expect(r.signal.reason).toMatch(/stop loss/i);
  });

  it("stop-loss never cuts a winner, and is off when unset", () => {
    // up 30% with stop-loss configured ⇒ NOT triggered (above entry)
    expect(evaluateExit(pos({ peakPriceUsd: 1.3 }), { currentPriceUsd: 1.3, now: 1000 }, { maxHoldMs: MAX_HOLD, stopLossPct: 0.45 }).signal.kind).toBe("HOLD");
    // down 60% but stop-loss unset (legacy) ⇒ HOLD
    expect(evaluateExit(pos({ peakPriceUsd: 1 }), { currentPriceUsd: 0.4, now: 1000 }, { maxHoldMs: MAX_HOLD }).signal.kind).toBe("HOLD");
  });

  it("time stop exits the remainder after MAX_HOLD", () => {
    const r = evaluateExit(
      pos({ entryAtMs: 0, peakPriceUsd: 1.1 }),
      { currentPriceUsd: 1.1, now: MAX_HOLD + 1 },
      { maxHoldMs: MAX_HOLD },
    );
    expect(r.signal.kind).toBe("SELL_EXIT_NOW");
    expect(r.signal.reason).toMatch(/time stop/i);
  });
});
