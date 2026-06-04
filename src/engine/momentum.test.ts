import { describe, it, expect } from "vitest";
import { computeMomentum } from "./momentum.js";
import { computeGraduation, progressFromMcapSol } from "./graduation.js";
import type { TradeEvent } from "../types.js";

function t(at: number, trader: string, side: "buy" | "sell", sol: number): TradeEvent {
  return { mint: "M", at, trader, side, solAmount: sol };
}

describe("computeMomentum", () => {
  it("rewards rising buyer velocity + buy pressure + acceleration", () => {
    // 60s window: light early, heavy late, all distinct buyers, all buys.
    const trades: TradeEvent[] = [];
    let at = 0;
    for (let i = 0; i < 3; i++) trades.push(t(at + i * 5000, `early${i}`, "buy", 0.3));
    at = 31_000;
    for (let i = 0; i < 12; i++) trades.push(t(at + i * 2000, `late${i}`, "buy", 1.2));
    const r = computeMomentum(trades, 60_000);
    expect(r.buySellRatio).toBe(1);
    expect(r.volumeAcceleration).toBeGreaterThan(1);
    expect(r.buyerVelocityTrend).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThanOrEqual(60);
  });

  it("scores fading, sell-dominated action low", () => {
    const trades: TradeEvent[] = [];
    for (let i = 0; i < 5; i++) trades.push(t(i * 4000, `b${i}`, "buy", 1));
    for (let i = 0; i < 12; i++) trades.push(t(30_000 + i * 2000, `s${i % 2}`, "sell", 1.5));
    const r = computeMomentum(trades, 60_000);
    expect(r.buySellRatio).toBeLessThan(0.5);
    expect(r.netSolInflow).toBeLessThan(0);
    expect(r.score).toBeLessThan(40);
  });
});

describe("computeGraduation", () => {
  it("rises with curve progress and fill velocity", () => {
    const low = computeGraduation(0.1, 0);
    const high = computeGraduation(0.7, 0.2);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("discounts a stalled curve", () => {
    const steady = computeGraduation(0.5, 0.1);
    const stalled = computeGraduation(0.5, 0);
    expect(stalled.score).toBeLessThan(steady.score);
  });

  it("progressFromMcapSol maps market cap to 0..1", () => {
    expect(progressFromMcapSol(0)).toBe(0);
    expect(progressFromMcapSol(460)).toBeCloseTo(1, 1);
    expect(progressFromMcapSol(99999)).toBe(1);
  });
});
