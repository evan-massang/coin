import type { DB } from "../db.js";
import type { TradeEvent } from "../../types.js";

/** Persistence for observed on-chain trades (token stream / wallet stream). */
export class TradesRepo {
  constructor(private readonly db: DB) {}

  insert(t: TradeEvent, source: "token" | "wallet" | "paper" = "token"): void {
    this.db
      .prepare(
        `INSERT INTO trades(mint, trader, side, sol_amount, token_amount, signature, at, source)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        t.mint,
        t.trader ?? null,
        t.side,
        t.solAmount ?? null,
        t.tokenAmount ?? null,
        t.signature ?? null,
        t.at,
        source,
      );
  }

  /** Trades for a mint since `sinceMs`, oldest first. */
  forMint(mint: string, sinceMs = 0): TradeEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM trades WHERE mint=? AND at>=? ORDER BY at ASC")
      .all(mint, sinceMs) as Record<string, unknown>[];
    return rows.map(rowToTrade);
  }

  /** Trades by a given trader since `sinceMs`, oldest first. */
  forTrader(trader: string, sinceMs = 0): TradeEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM trades WHERE trader=? AND at>=? ORDER BY at ASC")
      .all(trader, sinceMs) as Record<string, unknown>[];
    return rows.map(rowToTrade);
  }
}

function rowToTrade(r: Record<string, unknown>): TradeEvent {
  return {
    mint: r.mint as string,
    trader: (r.trader as string) ?? "",
    side: r.side as "buy" | "sell",
    solAmount: (r.sol_amount as number) ?? undefined,
    tokenAmount: (r.token_amount as number) ?? undefined,
    signature: (r.signature as string) ?? undefined,
    at: r.at as number,
  };
}
