import { describe, it, expect } from "vitest";
import { computeOrganicScore } from "./organicVolume.js";
import type { TradeEvent } from "../types.js";

function trade(p: Partial<TradeEvent> & { at: number; trader: string; side: "buy" | "sell" }): TradeEvent {
  return { mint: "M", solAmount: 0.5, ...p };
}

// Organic: many distinct buyers, varied sizes, mostly buys.
function organicStream(): TradeEvent[] {
  const sizes = [0.12, 0.37, 1.4, 0.08, 2.1, 0.55, 0.93, 0.21, 3.2, 0.44, 0.67, 1.1, 0.29, 0.81, 1.9, 0.15, 0.72, 2.4, 0.33, 0.58];
  return sizes.map((s, i) =>
    trade({ at: 1000 + i * 3000, trader: `buyer${i}`, side: "buy", solAmount: s }),
  );
}

// Wash: 3 wallets, identical 0.5 SOL sizes, perfect buy/sell alternation.
function washStream(): TradeEvent[] {
  const wallets = ["w0", "w1", "w2"];
  const out: TradeEvent[] = [];
  for (let i = 0; i < 20; i++) {
    out.push(trade({ at: 1000 + i * 1000, trader: wallets[i % 3]!, side: i % 2 === 0 ? "buy" : "sell", solAmount: 0.5 }));
  }
  return out;
}

describe("computeOrganicScore", () => {
  it("scores a diverse, varied-size buy stream as organic", () => {
    const r = computeOrganicScore(organicStream());
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.flags).not.toContain("identical-sizes");
    expect(r.uniqueBuyerRatio).toBeGreaterThan(0.9);
  });

  it("penalizes wash trading: identical sizes + regular alternation + few buyers", () => {
    const r = computeOrganicScore(washStream());
    expect(r.score).toBeLessThan(45);
    expect(r.flags.length).toBeGreaterThan(0);
    // Should catch at least one wash signature.
    expect(r.flags.some((f) => ["identical-sizes", "wash-alternation", "few-unique-buyers"].includes(f))).toBe(true);
  });

  it("returns a cautious neutral score on too little data", () => {
    const r = computeOrganicScore([
      trade({ at: 1, trader: "a", side: "buy" }),
      trade({ at: 2, trader: "b", side: "buy" }),
    ]);
    expect(r.score).toBe(45);
  });
});
