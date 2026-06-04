import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { parseTxDeltas, type ParsedTxLike } from "./txParser.js";
import { detectActivities } from "./positionDetector.js";
import { applyBuy, applySell, unrealizedSol, emptyPnl } from "./pnlCalculator.js";
import { PositionManager } from "../engine/positionManager.js";
import { PositionsRepo } from "../store/repositories/positionsRepo.js";
import { openDb, type DB } from "../store/db.js";

const OWNER = "OwnerWa11et1111111111111111111111111111111";
const MINT = "Mint1111111111111111111111111111111111111111";
const SOL_USD = 150;

function sol(n: number): number {
  return n * LAMPORTS_PER_SOL;
}

function buyTx(): ParsedTxLike {
  return {
    blockTime: 1000,
    transaction: { signatures: ["sigBuy"], message: { accountKeys: [OWNER, MINT] } },
    meta: {
      preBalances: [sol(5), 0],
      postBalances: [sol(3), 0], // spent 2 SOL
      preTokenBalances: [],
      postTokenBalances: [{ mint: MINT, owner: OWNER, uiTokenAmount: { uiAmount: 1_000_000, amount: "1000000000000", decimals: 6 } }],
    },
  };
}

function sellTx(): ParsedTxLike {
  return {
    blockTime: 2000,
    transaction: { signatures: ["sigSell"], message: { accountKeys: [OWNER, MINT] } },
    meta: {
      preBalances: [sol(3), 0],
      postBalances: [sol(8), 0], // received 5 SOL
      preTokenBalances: [{ mint: MINT, owner: OWNER, uiTokenAmount: { uiAmount: 1_000_000, amount: "1000000000000", decimals: 6 } }],
      postTokenBalances: [{ mint: MINT, owner: OWNER, uiTokenAmount: { uiAmount: 0, amount: "0", decimals: 6 } }],
    },
  };
}

describe("pnlCalculator", () => {
  it("weighted-average entry, realized + unrealized PnL", () => {
    let s = emptyPnl();
    s = applyBuy(s, 1000, 2); // 2 SOL for 1000 tokens → 0.002/token
    s = applyBuy(s, 1000, 4); // 4 SOL for 1000 → avg (6/2000)=0.003
    expect(s.avgEntryPriceSol).toBeCloseTo(0.003, 6);
    expect(unrealizedSol(s, 0.005)).toBeCloseTo((0.005 - 0.003) * 2000, 6); // +4 SOL
    const sold = applySell(s, 1000, 6); // sell half for 6 SOL; cost 3 → +3
    expect(sold.realizedDeltaSol).toBeCloseTo(3, 6);
    expect(sold.state.tokenAmount).toBe(1000);
  });
});

describe("txParser + positionDetector", () => {
  it("derives a buy with executed price from a tx", () => {
    const d = parseTxDeltas(buyTx(), OWNER)!;
    expect(d.solDelta).toBeCloseTo(-2, 6);
    expect(d.tokens[0]).toEqual({ mint: MINT, tokenDelta: 1_000_000 });
    const acts = detectActivities(d);
    expect(acts[0]!.side).toBe("buy");
    expect(acts[0]!.solAmount).toBeCloseTo(2, 6);
    expect(acts[0]!.priceSol).toBeCloseTo(2 / 1_000_000, 12);
  });
});

describe("PositionManager (Mark Entered / Closed + realized PnL)", () => {
  let db: DB;
  let mgr: PositionManager;
  let repo: PositionsRepo;

  beforeEach(() => {
    db = openDb(":memory:");
    repo = new PositionsRepo(db, "positions");
    mgr = new PositionManager(repo, "wallet");
  });
  afterEach(() => db.close());

  it("auto Mark Entered on a buy, then Mark Closed on a full sell with realized PnL", () => {
    const buy = detectActivities(parseTxDeltas(buyTx(), OWNER)!)[0]!;
    const entered = mgr.applyActivity(buy, { solUsd: SOL_USD });
    expect(entered.marked).toBe("entered");
    expect(entered.position!.tokenAmount).toBe(1_000_000);
    expect(repo.byStatus(true)).toHaveLength(1);

    const sell = detectActivities(parseTxDeltas(sellTx(), OWNER)!)[0]!;
    const closed = mgr.applyActivity(sell, { solUsd: SOL_USD });
    expect(closed.marked).toBe("closed");
    expect(closed.position!.status).toBe("CLOSED");
    // Bought for 2 SOL, sold for 5 SOL → +3 SOL → +$450 at $150/SOL.
    expect(closed.position!.realizedPnlUsd).toBeCloseTo(450, 0);
    expect(repo.byStatus(true)).toHaveLength(0);
    expect(repo.byStatus(false)).toHaveLength(1);
  });

  it("a sell of an untracked token is ignored (never goes negative)", () => {
    const sell = detectActivities(parseTxDeltas(sellTx(), OWNER)!)[0]!;
    expect(mgr.applyActivity(sell, { solUsd: SOL_USD }).marked).toBe("ignored");
  });
});
