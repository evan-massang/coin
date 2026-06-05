import { describe, it, expect } from "vitest";
import { snapshotsFromPairs } from "./dexscreener.js";

// The batch /tokens/ response interleaves pairs across the queried tokens, so the
// grouping must map each pair back to its mint via baseToken.address and keep the
// FIRST (most-liquid) pair per mint. These cases guard the exit engine's pricing.
describe("snapshotsFromPairs", () => {
  it("maps one snapshot per mint, keeping the first pair seen", () => {
    const pairs = [
      { baseToken: { address: "AAA" }, priceUsd: "1.5", liquidity: { usd: 9000 } },
      { baseToken: { address: "AAA" }, priceUsd: "1.4", liquidity: { usd: 10 } }, // 2nd pair, ignored
      { baseToken: { address: "BBB" }, priceUsd: "0.002" },
    ];
    const m = snapshotsFromPairs(pairs);
    expect(m.size).toBe(2);
    expect(m.get("AAA")?.priceUsd).toBe(1.5);
    expect(m.get("BBB")?.priceUsd).toBe(0.002);
  });

  it("ignores pairs with no baseToken address", () => {
    const m = snapshotsFromPairs([{ priceUsd: "1" }, { baseToken: {}, priceUsd: "2" }]);
    expect(m.size).toBe(0);
  });

  it("restrictTo drops mints that were not requested", () => {
    const pairs = [
      { baseToken: { address: "AAA" }, priceUsd: "1" },
      { baseToken: { address: "ZZZ" }, priceUsd: "9" }, // not requested
    ];
    const m = snapshotsFromPairs(pairs, new Set(["AAA"]));
    expect([...m.keys()]).toEqual(["AAA"]);
  });

  it("carries through liquidity, txns and price change", () => {
    const m = snapshotsFromPairs([
      { baseToken: { address: "AAA" }, priceUsd: "1", liquidity: { usd: 4200 }, txns: { m5: { buys: 7, sells: 3 } }, priceChange: { m5: 12 } },
    ]);
    const s = m.get("AAA")!;
    expect(s.liquidityUsd).toBe(4200);
    expect(s.txns?.m5?.buys).toBe(7);
    expect(s.priceChange?.m5).toBe(12);
  });
});
