import { describe, it, expect } from "vitest";
import { pickWatchVictim, type WatchSlot } from "./watchAllocator.js";

const slot = (over: Partial<WatchSlot>): WatchSlot => ({ mint: "m", age: 60_000, trades: 0, lastTradeAt: 0, ...over });

describe("pickWatchVictim — slot recycling invariants (Cycle 3)", () => {
  it("never evicts an active token (trades >= sufficientTrades)", () => {
    const slots = [slot({ mint: "active", trades: 12, age: 90_000 }), slot({ mint: "active2", trades: 8 })];
    expect(pickWatchVictim(slots, 25_000, 8)).toBeUndefined();
  });

  it("never evicts a young token (age < min-tenure) — no thrashing", () => {
    expect(pickWatchVictim([slot({ mint: "young", age: 10_000, trades: 0 })], 25_000, 8)).toBeUndefined();
  });

  it("evicts the deadest: fewest trades, then oldest last-trade", () => {
    const slots = [
      slot({ mint: "a", trades: 3, lastTradeAt: 5000 }),
      slot({ mint: "deadest", trades: 1, lastTradeAt: 1000 }),
      slot({ mint: "c", trades: 1, lastTradeAt: 9000 }),
    ];
    expect(pickWatchVictim(slots, 25_000, 8)).toBe("deadest");
  });

  it("returns undefined when every slot is active or too young (stays bounded)", () => {
    const slots = [slot({ mint: "a", trades: 10 }), slot({ mint: "b", age: 5_000, trades: 0 })];
    expect(pickWatchVictim(slots, 25_000, 8)).toBeUndefined();
  });

  it("prefers a zero-trade slot over a 1-trade slot", () => {
    const slots = [slot({ mint: "one", trades: 1 }), slot({ mint: "zero", trades: 0 })];
    expect(pickWatchVictim(slots, 25_000, 8)).toBe("zero");
  });
});
