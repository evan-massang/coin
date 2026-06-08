import { describe, it, expect } from "vitest";
import { passesGoldenFilter, statsFromPairs, statsFromGeckoPools, type GoldenFilter, type PairStats } from "./dexScanner.js";

const F: GoldenFilter = { minMcapUsd: 50_000, maxMcapUsd: 200_000, minLiqUsd: 30_000, minVolMcRatio: 2, maxAgeHours: 6 };
const NOW = 1_000_000_000_000;
const base: PairStats = { mint: "M", mcapUsd: 100_000, liqUsd: 40_000, vol24Usd: 300_000, ageMs: 2 * 3_600_000 };

describe("passesGoldenFilter", () => {
  it("accepts a maturing survivor in the sweet spot", () => {
    expect(passesGoldenFilter(base, F, NOW)).toBe(true);
  });
  it("rejects market cap outside [50k,200k]", () => {
    expect(passesGoldenFilter({ ...base, mcapUsd: 30_000 }, F, NOW)).toBe(false);
    expect(passesGoldenFilter({ ...base, mcapUsd: 250_000 }, F, NOW)).toBe(false);
  });
  it("rejects thin liquidity (< $30k — can't exit)", () => {
    expect(passesGoldenFilter({ ...base, liqUsd: 20_000 }, F, NOW)).toBe(false);
  });
  it("rejects low volume/mcap ratio (< 2)", () => {
    expect(passesGoldenFilter({ ...base, vol24Usd: 150_000 }, F, NOW)).toBe(false); // 1.5x
  });
  it("rejects stale pairs (> 6h old — not the first wave)", () => {
    expect(passesGoldenFilter({ ...base, ageMs: 7 * 3_600_000 }, F, NOW)).toBe(false);
  });
  it("rejects when a required field is unknown", () => {
    expect(passesGoldenFilter({ ...base, liqUsd: undefined }, F, NOW)).toBe(false);
    expect(passesGoldenFilter({ ...base, ageMs: undefined }, F, NOW)).toBe(false);
  });
});

describe("statsFromPairs", () => {
  it("keeps only Solana pairs and picks the most-liquid per mint", () => {
    const pairs = [
      { chainId: "bsc", baseToken: { address: "X" }, liquidity: { usd: 99_000 } },
      { chainId: "solana", baseToken: { address: "A", name: "Aaa", symbol: "AAA" }, marketCap: 100_000, liquidity: { usd: 30_000 }, volume: { h24: 200_000 }, pairCreatedAt: NOW - 3_600_000 },
      { chainId: "solana", baseToken: { address: "A", symbol: "AAA" }, marketCap: 100_000, liquidity: { usd: 80_000 }, volume: { h24: 400_000 }, pairCreatedAt: NOW - 3_600_000 },
    ];
    const m = statsFromPairs(pairs, NOW);
    expect(m.has("X")).toBe(false); // bsc dropped
    expect(m.get("A")?.liqUsd).toBe(80_000); // most-liquid pair kept
    expect(m.get("A")?.ageMs).toBe(3_600_000);
    expect(m.get("A")?.symbol).toBe("AAA");
  });
});

describe("statsFromGeckoPools", () => {
  it("parses GeckoTerminal pools into maturity stats (mint, mcap, liq, vol, age, symbol)", () => {
    const pools = [
      {
        attributes: { name: "three / SOL", market_cap_usd: "120000", reserve_in_usd: "45000", volume_usd: { h24: "300000" }, pool_created_at: new Date(NOW - 2 * 3_600_000).toISOString() },
        relationships: { base_token: { data: { id: "solana_MintAAA" } } },
      },
      { attributes: { name: "eth thing / WETH" }, relationships: { base_token: { data: { id: "eth_0xabc" } } } }, // non-solana dropped
    ];
    const m = statsFromGeckoPools(pools, NOW);
    expect(m.has("0xabc")).toBe(false);
    const a = m.get("MintAAA")!;
    expect(a.mcapUsd).toBe(120000);
    expect(a.liqUsd).toBe(45000);
    expect(a.vol24Usd).toBe(300000);
    expect(a.symbol).toBe("three");
    expect(Math.round((a.ageMs ?? 0) / 3_600_000)).toBe(2);
    expect(passesGoldenFilter(a, F, NOW)).toBe(true); // a real maturing survivor
  });
});
