import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { simulateBuy, simulateSell } from "./paperExecution.js";
import { PaperWallet } from "./paperWallet.js";
import { PositionManager } from "../engine/positionManager.js";
import { evaluateExit, defaultExitPlan } from "../engine/exitEngine.js";
import { PaperRepo } from "../store/repositories/paperRepo.js";
import { PositionsRepo } from "../store/repositories/positionsRepo.js";
import { openDb, type DB } from "../store/db.js";

const SOL_USD = 150;

describe("simulated fills", () => {
  it("buy fills worse by slippage and converts SOL→tokens", () => {
    const r = simulateBuy(0.001, SOL_USD, 1, 2);
    expect(r.effPriceUsd).toBeCloseTo(0.00102, 6);
    expect(r.tokenAmount).toBeCloseTo((1 * SOL_USD) / 0.00102, 2);
    expect(r.solSpent).toBe(1);
  });

  it("sell fills worse by slippage and converts tokens→SOL", () => {
    const r = simulateSell(0.002, SOL_USD, 100_000, 2);
    expect(r.effPriceUsd).toBeCloseTo(0.00196, 6);
    expect(r.solReceived).toBeCloseTo((100_000 * 0.00196) / SOL_USD, 6);
  });
});

describe("paper buy → exit-engine trim → sell cycle", () => {
  let db: DB;
  let wallet: PaperWallet;
  let positions: PositionManager;
  let repo: PositionsRepo;

  beforeEach(() => {
    db = openDb(":memory:");
    wallet = new PaperWallet(new PaperRepo(db));
    repo = new PositionsRepo(db, "paper_positions");
    positions = new PositionManager(repo, "paper");
    wallet.ensure(10);
  });
  afterEach(() => db.close());

  it("debits the wallet on a buy, then the SAME exit engine trims at 2x", () => {
    // Buy 1 SOL worth at $0.001 (2% slippage).
    const buy = simulateBuy(0.001, SOL_USD, 1, 2);
    expect(wallet.debit(1)).toBe(true);
    expect(wallet.balance()).toBeCloseTo(9, 6);
    const priceSolEntry = buy.effPriceUsd / SOL_USD;
    const entered = positions.applyActivity(
      { mint: "M", side: "buy", tokenAmount: buy.tokenAmount, solAmount: 1, priceSol: priceSolEntry, at: 1000, signature: "paper" },
      { symbol: "WIF", solUsd: SOL_USD },
    );
    const pos = entered.position!;
    pos.exitPlan = defaultExitPlan(60 * 60 * 1000);
    pos.lastPriceUsd = 0.0025; // 2.45x of the $0.00102 entry
    pos.peakPriceUsd = 0.0025;
    repo.update(pos);

    // Exit engine (the very same evaluateExit used for real alerts) fires a trim.
    const evalResult = evaluateExit(pos, { currentPriceUsd: 0.0025, now: 5000 }, { maxHoldMs: 60 * 60 * 1000 });
    expect(evalResult.signal.kind).toBe("SELL_TRIM");
    expect(evalResult.signal.sellPct).toBeCloseTo(0.4, 2);

    // Execute the simulated sell.
    const sellTokens = pos.tokenAmount * evalResult.signal.sellPct;
    const sell = simulateSell(0.0025, SOL_USD, sellTokens, 2);
    wallet.credit(sell.solReceived);
    const after = positions.applyActivity(
      { mint: "M", side: "sell", tokenAmount: sellTokens, solAmount: sell.solReceived, priceSol: sell.effPriceUsd / SOL_USD, at: 6000, signature: "paper" },
      { symbol: "WIF", solUsd: SOL_USD },
    );

    expect(after.marked).toBe("reduced");
    expect(after.position!.status).toBe("PARTIAL");
    expect(after.position!.tokenAmount).toBeCloseTo(buy.tokenAmount * 0.6, 2);
    // Sold 40% bought at ~$0.00102 for ~$0.00245 → realized profit.
    expect(after.position!.realizedPnlUsd).toBeGreaterThan(0);
    expect(wallet.balance()).toBeGreaterThan(9);
  });
});
