import { describe, it, expect } from "vitest";
import { SCORE_AGENTS } from "./scoreAgents.js";
import type { AgentContext } from "./types.js";
import type { TradeEvent } from "../types.js";

function buys(n: number): TradeEvent[] {
  return Array.from({ length: n }, (_, i) => ({ mint: "M", trader: "w" + i, side: "buy" as const, solAmount: 0.5, marketCapSol: 30 + i, at: 1000 + i * 100 }));
}
function ctx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    token: { mint: "M", seenAt: 0 }, trades: [], now: 2000, firstSeenAt: 0,
    marketCapsSol: [30, 31, 32], smartWallets: new Map(), minBuys: 8,
    hype: async () => ({ score: 50, isRevival: false, source: "heuristic", rationale: "", tags: [] }), ...over,
  };
}
const agent = (id: string) => SCORE_AGENTS.find((a) => a.id === id)!;

describe("score agents — sufficiency gating (Cycle 1 fix)", () => {
  it("organic is UNKNOWN below minBuys even for a clean 5-distinct-buyer cluster", async () => {
    const out = await agent("organic").run(ctx({ trades: buys(5) }));
    expect(out.unknown).toBe(true);
    expect(out.confidence).toBe(0); // would-be organic=100 must NOT carry confidence on <8 trades
  });

  it("organic is confident at >= minBuys trades", async () => {
    const out = await agent("organic").run(ctx({ trades: buys(10) }));
    expect(out.unknown).toBeFalsy();
    expect(out.confidence).toBe(0.9);
  });

  it("momentum is UNKNOWN below minBuys", async () => {
    expect((await agent("momentum").run(ctx({ trades: buys(4) }))).unknown).toBe(true);
  });

  it("smartMoney is UNKNOWN with no tracked wallets (not a frozen 50)", async () => {
    expect((await agent("smartMoney").run(ctx({ trades: buys(10), smartWallets: new Map() }))).unknown).toBe(true);
  });

  it("devReputation is UNKNOWN until devSold is known", async () => {
    expect((await agent("devReputation").run(ctx({ devSold: undefined }))).unknown).toBe(true);
    expect((await agent("devReputation").run(ctx({ devSold: false }))).unknown).toBeFalsy();
  });
});
