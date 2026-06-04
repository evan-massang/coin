import { describe, it, expect } from "vitest";
import { buildRoundTrips, scoreWallet, shouldCopy, detectAlphaExit } from "./copyTracker.js";
import type { TradeEvent } from "../types.js";

function tr(p: Partial<TradeEvent> & { mint: string; side: "buy" | "sell"; at: number }): TradeEvent {
  return { trader: "W", solAmount: 1, tokenAmount: 1000, ...p };
}

// One 3x winner + one rug, for wallet W.
function history(): TradeEvent[] {
  return [
    tr({ mint: "WIN", side: "buy", at: 1000, solAmount: 1, tokenAmount: 1000 }),
    tr({ mint: "WIN", side: "sell", at: 5000, solAmount: 3, tokenAmount: 1000 }),
    tr({ mint: "RUG", side: "buy", at: 2000, solAmount: 1, tokenAmount: 1000 }),
    tr({ mint: "RUG", side: "sell", at: 9000, solAmount: 0.05, tokenAmount: 1000 }),
  ];
}

describe("buildRoundTrips", () => {
  it("reconstructs closed round-trips with multiples + rug flag", () => {
    const trips = buildRoundTrips(history(), 10_000);
    const win = trips.find((t) => t.mint === "WIN")!;
    const rug = trips.find((t) => t.mint === "RUG")!;
    expect(win.multiple).toBeCloseTo(3, 2);
    expect(win.rug).toBe(false);
    expect(rug.rug).toBe(true);
  });

  it("ignores still-open positions (bought, not fully sold)", () => {
    const trips = buildRoundTrips([tr({ mint: "OPEN", side: "buy", at: 1, solAmount: 1, tokenAmount: 1000 })]);
    expect(trips).toHaveLength(0);
  });
});

describe("scoreWallet", () => {
  it("scores a profitable, low-rug wallet well", () => {
    const winnerOnly: TradeEvent[] = [
      tr({ mint: "A", side: "buy", at: 1, solAmount: 1, tokenAmount: 1000 }),
      tr({ mint: "A", side: "sell", at: 2, solAmount: 4, tokenAmount: 1000 }),
      tr({ mint: "B", side: "buy", at: 3, solAmount: 1, tokenAmount: 1000 }),
      tr({ mint: "B", side: "sell", at: 4, solAmount: 2.5, tokenAmount: 1000 }),
    ];
    const s = scoreWallet("W", winnerOnly);
    expect(s.twoXHitRate).toBe(1);
    expect(s.rugExposureRate).toBe(0);
    expect(s.score).toBeGreaterThanOrEqual(60);
  });

  it("penalizes a rug-prone wallet and flags it", () => {
    const ruggy: TradeEvent[] = [
      tr({ mint: "A", side: "buy", at: 1, solAmount: 1, tokenAmount: 1000 }),
      tr({ mint: "A", side: "sell", at: 2, solAmount: 0.02, tokenAmount: 1000 }),
      tr({ mint: "B", side: "buy", at: 3, solAmount: 1, tokenAmount: 1000 }),
      tr({ mint: "B", side: "sell", at: 4, solAmount: 0.05, tokenAmount: 1000 }),
    ];
    const s = scoreWallet("W", ruggy);
    expect(s.rugExposureRate).toBe(1);
    expect(s.score).toBeLessThan(40);
    expect(s.blockReasons.length).toBeGreaterThan(0);
  });
});

describe("shouldCopy don't-copy rules", () => {
  const good = scoreWallet("W", [
    tr({ mint: "A", side: "buy", at: 1, solAmount: 1, tokenAmount: 1000 }),
    tr({ mint: "A", side: "sell", at: 2, solAmount: 4, tokenAmount: 1000 }),
    tr({ mint: "B", side: "buy", at: 3, solAmount: 1, tokenAmount: 1000 }),
    tr({ mint: "B", side: "sell", at: 4, solAmount: 3, tokenAmount: 1000 }),
  ]);

  it("copies a strong wallet on a safe token at a fair price", () => {
    expect(shouldCopy(good, { tokenPassedStage0: true, currentPriceVsWalletEntryPct: 5 }).copy).toBe(true);
  });

  it("refuses when the token failed Stage-0", () => {
    expect(shouldCopy(good, { tokenPassedStage0: false }).copy).toBe(false);
  });

  it("refuses when chasing >20% above the wallet's entry", () => {
    const r = shouldCopy(good, { tokenPassedStage0: true, currentPriceVsWalletEntryPct: 35 });
    expect(r.copy).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/above/i);
  });

  it("refuses on a shared funding source", () => {
    expect(shouldCopy(good, { tokenPassedStage0: true, sharedFundingSource: true }).copy).toBe(false);
  });
});

describe("detectAlphaExit", () => {
  it("flags when a tracked wallet sells the mint", () => {
    const trades = [tr({ trader: "alpha", mint: "X", side: "sell", at: 1 })];
    expect(detectAlphaExit("alpha", trades, "X")).toBe(true);
    expect(detectAlphaExit("alpha", trades, "Y")).toBe(false);
  });
});
