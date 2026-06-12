import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../store/db.js";
import { SettingsStore } from "../store/settingsStore.js";
import { PaperRepo } from "../store/repositories/paperRepo.js";
import { PositionsRepo } from "../store/repositories/positionsRepo.js";
import { RealizedTradesRepo } from "../store/repositories/realizedTradesRepo.js";
import { PaperTrader } from "./paperExecution.js";
import type { Services } from "../services.js";
import type { Decision, ExitSignal } from "../types.js";

// P0 Measurement: every CLOSED paper position must land exactly once in the
// DURABLE realized_trades journal — with the round-trip SOL numbers taken from
// its own fills, the buy verdict + provenance flags, the exit reason, and the
// first-5-minute drawdown — and the journal must SURVIVE /paper/reset.

vi.mock("../sources/coingecko.js", () => ({
  getSolUsd: vi.fn(async () => 200),
}));
vi.mock("../sources/dexscreener.js", () => ({
  fetchDexSnapshot: vi.fn(async () => ({ priceUsd: 0.0001, liquidityUsd: 50_000 })),
}));

const signal = (mint: string, sellPct: number, reason = "Stop loss: -40% from entry"): ExitSignal =>
  ({ mint, kind: "SELL_EXIT_NOW", sellPct, reason, hard: false, at: Date.now() });

const decision = (mint: string, flags: string[] = []): Decision =>
  ({
    mint, symbol: "TEST", verdict: "BUY_SMALL", conviction: 69,
    scores: { safety: 80, organic: 70, momentum: 60, graduation: 50, devReputation: 50, smartMoney: 50, social: 40, hype: 30, lateEntryRisk: 10, attention: 92 },
    reasons: [], flags, caps: [], suggestedRiskPct: 1, maxPositionSol: 1, at: Date.now(),
  }) as unknown as Decision;

describe("PaperTrader close → durable realized journal (P0)", () => {
  let db: DB;
  let svc: Services;
  let trader: PaperTrader;
  let positions: PositionsRepo;
  let paper: PaperRepo;
  let realized: RealizedTradesRepo;

  beforeEach(() => {
    db = openDb(":memory:");
    const settings = new SettingsStore(db);
    settings.update({ paperEnabled: true, paperStartingBalanceSol: 10 });
    paper = new PaperRepo(db);
    paper.ensure(10);
    positions = new PositionsRepo(db, "paper_positions");
    realized = new RealizedTradesRepo(db);
    svc = { settings, paper, paperPositions: positions, realized, hub: { broadcast: () => {} } } as unknown as Services;
    trader = new PaperTrader(svc);
  });
  afterEach(() => db.close());

  it("full round-trip journals once with exact fill sums + verdict + flags + reason", async () => {
    await trader.onDecision(decision("M1", ["research:manus", "src:scan"]));
    const pos = positions.openByMint("M1")!;
    expect(pos).toBeDefined();
    await trader.executeSell(pos, signal("M1", 1));

    const rows = realized.recent(10);
    expect(rows).toHaveLength(1);
    const t = rows[0]!;
    expect(t.positionId).toBe(pos.id);
    expect(t.verdict).toBe("BUY_SMALL");
    expect(t.flags).toBe("research:manus,src:scan");
    expect(t.exitReason).toContain("Stop loss");
    expect(t.approx).toBe(false);
    // Numbers tie EXACTLY to this position's fills.
    const fills = paper.fillsForPosition(pos.id);
    const inv = fills.filter((f) => f.side === "buy").reduce((s, f) => s + f.solAmount, 0);
    const ret = fills.filter((f) => f.side === "sell").reduce((s, f) => s + f.solAmount, 0);
    expect(t.solInvested).toBeCloseTo(inv, 9);
    expect(t.solReturned).toBeCloseTo(ret, 9);
    expect(t.realizedPnlSol).toBeCloseTo(ret - inv, 9);
    expect(t.realizedPnlSol).toBeLessThan(0); // round-trip at flat price loses the slippage
  });

  it("partial trims then close → ONE row aggregating every sell", async () => {
    await trader.onDecision(decision("M2"));
    await trader.executeSell(positions.openByMint("M2")!, signal("M2", 0.5, "Ladder 1.4x"));
    expect(realized.recent(10)).toHaveLength(0); // still open — nothing journaled yet
    await trader.executeSell(positions.openByMint("M2")!, signal("M2", 1, "Time stop: held > 240m"));
    const rows = realized.recent(10);
    expect(rows).toHaveLength(1);
    const fills = paper.fillsForPosition(rows[0]!.positionId);
    const sells = fills.filter((f) => f.side === "sell");
    expect(sells).toHaveLength(2);
    expect(rows[0]!.solReturned).toBeCloseTo(sells.reduce((s, f) => s + f.solAmount, 0), 9);
    expect(rows[0]!.exitReason).toContain("Time stop"); // the CLOSING reason
  });

  it("re-fired exits cannot double-journal (UNIQUE position_id)", async () => {
    await trader.onDecision(decision("M3"));
    const stale = positions.openByMint("M3")!;
    await trader.executeSell(stale, signal("M3", 1));
    await trader.executeSell({ ...stale, status: "OPEN", tokenAmount: stale.tokenAmount }, signal("M3", 1));
    expect(realized.recent(10)).toHaveLength(1);
  });

  it("dd@5m comes from the position's early price samples", async () => {
    await trader.onDecision(decision("M4"));
    const pos = positions.openByMint("M4")!;
    paper.recordPriceSample(pos.id, pos.entryAtMs + 60_000, -8);
    paper.recordPriceSample(pos.id, pos.entryAtMs + 4 * 60_000, -31);
    paper.recordPriceSample(pos.id, pos.entryAtMs + 20 * 60_000, -70); // outside the 5m window
    await trader.executeSell(pos, signal("M4", 1));
    expect(realized.recent(1)[0]!.dd5mPct).toBe(-31);
  });

  it("the journal SURVIVES a paper reset; the sim tables do not", async () => {
    await trader.onDecision(decision("M5"));
    await trader.executeSell(positions.openByMint("M5")!, signal("M5", 1));
    expect(realized.recent(10)).toHaveLength(1);
    paper.reset(10);
    expect(paper.fills(10)).toHaveLength(0); // sim history wiped
    expect(positions.all()).toHaveLength(0);
    expect(realized.recent(10)).toHaveLength(1); // the durable record remains
    expect(realized.totals(0).trades).toBe(1);
  });

  it("pre-v15 positions (no position_id on fills) journal via mint window, marked approx", async () => {
    const id = positions.open({
      mint: "OLD", symbol: "OLD", source: "paper", status: "OPEN", entryPriceUsd: 0.0001,
      entryAtMs: Date.now() - 60_000, tokenAmount: 200_000, initialTokenAmount: 200_000,
      solInvested: 0.1, costBasisUsd: 20, realizedPnlUsd: 0, peakPriceUsd: 0.0001,
      lastPriceUsd: 0.0001, exitPlan: { ladder: [], trailingStopPct: 0.35, maxHoldMs: 0 },
    });
    paper.recordFill({ mint: "OLD", side: "buy", priceUsd: 0.0001, solAmount: 0.1, tokenAmount: 200_000, realizedPnlSol: 0, remainingTokenAmount: 200_000, reason: "BUY_SMALL", at: Date.now() - 60_000 });
    await trader.executeSell(positions.get(id)!, signal("OLD", 1));
    const t = realized.recent(1)[0]!;
    expect(t.approx).toBe(true);
    expect(t.solInvested).toBeCloseTo(0.1, 9);
    expect(t.verdict).toBe("BUY_SMALL");
  });

  it("equity curve accumulates per close, oldest first", async () => {
    for (const m of ["A", "B"]) {
      await trader.onDecision(decision(m));
      await trader.executeSell(positions.openByMint(m)!, signal(m, 1));
    }
    const curve = realized.equityCurve(0);
    expect(curve).toHaveLength(2);
    expect(curve[1]!.cumSol).toBeCloseTo(curve[0]!.cumSol + curve[1]!.pnlSol, 9);
  });
});
