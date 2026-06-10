import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../store/db.js";
import { SettingsStore } from "../store/settingsStore.js";
import { PaperRepo } from "../store/repositories/paperRepo.js";
import { PositionsRepo } from "../store/repositories/positionsRepo.js";
import { PaperTrader } from "./paperExecution.js";
import type { Services } from "../services.js";
import type { ExitSignal, Position } from "../types.js";

// V5.1 P0 regression guard: the exit engine re-fires full exits every tick, and
// executeSell used to sell from the caller's STALE position snapshot — one
// position fully sold 2-3 times, crediting cash for tokens that never existed
// (~44.8 SOL of phantom proceeds; 492 mints sold more than they bought). These
// tests pin token conservation: a position can never be sold past its holdings,
// no matter how many times or how concurrently the exit engine fires.

vi.mock("../sources/coingecko.js", () => ({
  // Async-yielding so concurrent executeSell calls genuinely overlap in the test.
  getSolUsd: vi.fn(async () => {
    await new Promise((r) => setImmediate(r));
    return 200;
  }),
}));
vi.mock("../sources/dexscreener.js", () => ({
  fetchDexSnapshot: vi.fn(async () => ({ priceUsd: 0.0001 })),
}));

function exitSignal(sellPct: number): ExitSignal {
  return { mint: "M1", kind: "SELL_EXIT_NOW", sellPct, reason: "Time stop: held > 240m", hard: false, at: Date.now() };
}

describe("PaperTrader.executeSell — token conservation under re-fired exits", () => {
  let db: DB;
  let svc: Services;
  let trader: PaperTrader;
  let positions: PositionsRepo;
  let paper: PaperRepo;

  beforeEach(() => {
    db = openDb(":memory:");
    const settings = new SettingsStore(db);
    settings.update({ paperEnabled: true, paperStartingBalanceSol: 10 });
    paper = new PaperRepo(db);
    paper.ensure(10);
    positions = new PositionsRepo(db, "paper_positions");
    svc = { settings, paper, paperPositions: positions, hub: { broadcast: () => {} } } as unknown as Services;
    trader = new PaperTrader(svc);
    positions.open({
      mint: "M1",
      symbol: "DOGE",
      source: "paper",
      status: "OPEN",
      entryPriceUsd: 0.0001,
      entryAtMs: Date.now() - 300 * 60_000,
      tokenAmount: 1_000_000,
      initialTokenAmount: 1_000_000,
      solInvested: 0.5,
      costBasisUsd: 100,
      realizedPnlUsd: 0,
      peakPriceUsd: 0.0001,
      lastPriceUsd: 0.0001,
      exitPlan: { ladder: [], trailingStopPct: 0.35, maxHoldMs: 0 },
    });
  });
  afterEach(() => db.close());

  const stalePos = (): Position => positions.openByMint("M1")!;

  it("SEQUENTIAL re-fire with a stale snapshot: second full sell is a no-op", async () => {
    const stale = stalePos(); // exit engine's snapshot — same object both times
    await trader.executeSell(stale, exitSignal(1));
    const balAfterFirst = paper.get()!.balanceSol;
    await trader.executeSell(stale, exitSignal(1)); // re-fired tick, stale object
    expect(paper.get()!.balanceSol).toBe(balAfterFirst); // no second credit
    const sells = paper.fills(10).filter((f) => f.side === "sell");
    expect(sells).toHaveLength(1); // one fill, not two
    expect(positions.get(stale.id)!.status).toBe("CLOSED");
  });

  it("CONCURRENT re-fire (overlapping awaits): the in-flight lock admits exactly one sell", async () => {
    const stale = stalePos();
    await Promise.all([trader.executeSell(stale, exitSignal(1)), trader.executeSell(stale, exitSignal(1))]);
    const sells = paper.fills(10).filter((f) => f.side === "sell");
    expect(sells).toHaveLength(1);
    // Conservation: tokens sold ≤ tokens bought (held).
    const sold = sells.reduce((a, f) => a + f.tokenAmount, 0);
    expect(sold).toBeLessThanOrEqual(1_000_000);
    // Cash: exactly one credit of ~0.49 SOL (0.5 SOL position, 2% slippage).
    const bal = paper.get()!.balanceSol;
    expect(bal).toBeGreaterThan(10.4);
    expect(bal).toBeLessThan(10.6);
  });

  it("partial sells conserve: two 50% trims sell exactly the full holding, never more", async () => {
    await trader.executeSell(stalePos(), exitSignal(0.5));
    await trader.executeSell(stalePos(), exitSignal(0.5)); // fresh read: 50% of REMAINING
    await trader.executeSell(stalePos(), exitSignal(1)); // close the rest
    const sells = paper.fills(10).filter((f) => f.side === "sell");
    const sold = sells.reduce((a, f) => a + f.tokenAmount, 0);
    expect(sold).toBeLessThanOrEqual(1_000_000 + 1e-6);
    // Ledger ≈ cash identity: Σ realized = Σ proceeds − full cost basis.
    const proceeds = sells.reduce((a, f) => a + f.solAmount, 0);
    const realized = sells.reduce((a, f) => a + f.realizedPnlSol, 0);
    expect(realized).toBeCloseTo(proceeds - 0.5, 6);
  });

  it("scan-shadow: scanner coins stay journal-only UNLESS Manus validated them", async () => {
    const decision = (flags: string[]) => ({
      mint: "M2", symbol: "BREAD", verdict: "BUY_SMALL" as const, conviction: 69,
      scores: { safety: 80, organic: 70, momentum: 60, graduation: 50, devReputation: 50, smartMoney: 50, social: 40, hype: 30, lateEntryRisk: 10, attention: 92 },
      reasons: [], flags, caps: [], suggestedRiskPct: 1, maxPositionSol: 1, at: Date.now(),
    });
    // Plain scan coin (shadow A/B) → NO paper buy.
    await trader.onDecision(decision(["src:scan"]));
    expect(positions.openByMint("M2")).toBeUndefined();
    // Same coin validated by Manus deep research → the buy executes.
    await trader.onDecision(decision(["src:scan", "research:manus"]));
    const pos = positions.openByMint("M2");
    expect(pos).toBeDefined();
    expect(pos!.solInvested).toBeGreaterThan(0);
  });

  it("a sell against an already-CLOSED position never credits the wallet", async () => {
    const stale = stalePos();
    await trader.executeSell(stale, exitSignal(1)); // closes it
    const bal = paper.get()!.balanceSol;
    // Simulate a long-stale exit-engine snapshot firing days later.
    await trader.executeSell({ ...stale, tokenAmount: 1_000_000, status: "OPEN" }, exitSignal(1));
    expect(paper.get()!.balanceSol).toBe(bal);
  });
});
