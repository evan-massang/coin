import { describe, it, expect } from "vitest";
import { dexSignals } from "./dexMomentum.js";
import type { MarketSnapshot } from "../types.js";

const snap = (over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({ mint: "M", at: 0, ...over });

describe("dexSignals — free DexScreener trade-flow proxy (Cycle 4)", () => {
  it("not confident with no pair / too few txns", () => {
    expect(dexSignals(undefined).confident).toBe(false);
    expect(dexSignals(snap({ txns: { m5: { buys: 2, sells: 1 } } })).confident).toBe(false); // <8 txns
  });

  it("confident on txn activity even with liquidity=$0 (pump.fun bonding curve)", () => {
    const d = dexSignals(snap({ liquidityUsd: 0, txns: { m5: { buys: 20, sells: 6 } }, volume: { m5: 3000 }, priceChange: { m5: 12 } }));
    expect(d.confident).toBe(true);
    expect(d.txns5m).toBe(26);
  });

  it("organic reflects buy pressure", () => {
    const heavyBuy = dexSignals(snap({ liquidityUsd: 8000, txns: { m5: { buys: 27, sells: 3 } } }));
    const dumping = dexSignals(snap({ liquidityUsd: 8000, txns: { m5: { buys: 4, sells: 26 } } }));
    expect(heavyBuy.organic).toBeGreaterThan(dumping.organic);
    expect(dumping.organic).toBeLessThan(40); // sell-dominated ⇒ low organic
  });

  it("momentum rewards the early/flat sweet-spot + velocity, penalizes chasing a pump (Cycle 8 pivot)", () => {
    const sweet = dexSignals(snap({ liquidityUsd: 8000, txns: { m5: { buys: 40, sells: 8 } }, volume: { m5: 9000 }, priceChange: { m5: 8 } })); // flat/early + alive
    const chase = dexSignals(snap({ liquidityUsd: 8000, txns: { m5: { buys: 40, sells: 8 } }, volume: { m5: 9000 }, priceChange: { m5: 60 } })); // already pumped +60%
    const knife = dexSignals(snap({ liquidityUsd: 8000, txns: { m5: { buys: 5, sells: 18 } }, volume: { m5: 200 }, priceChange: { m5: -45 } })); // dumping hard
    expect(sweet.momentum).toBeGreaterThan(chase.momentum); // don't chase a pump
    expect(sweet.momentum).toBeGreaterThan(knife.momentum); // don't catch a falling knife
    expect(sweet.momentum).toBeGreaterThanOrEqual(55); // early + alive scores high
  });
});
