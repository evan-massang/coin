import type { DB } from "../db.js";

// Paper sim wallet state (paper_wallet singleton) + simulated fills (paper_trades).
// Paper *positions* use PositionsRepo("paper_positions"). Simulation only — no
// keys, no signing, no on-chain anything.

export interface PaperWalletState {
  startingBalanceSol: number;
  balanceSol: number;
  createdAt: number;
  updatedAt: number;
}

export interface PaperFill {
  id?: number;
  mint: string;
  side: "buy" | "sell";
  priceUsd: number;
  solAmount: number;
  tokenAmount: number;
  realizedPnlSol: number;
  remainingTokenAmount: number;
  reason?: string;
  at: number;
}

export class PaperRepo {
  constructor(private readonly db: DB) {}

  /** Create the singleton wallet if it doesn't exist. */
  ensure(startingBalanceSol: number, now = Date.now()): PaperWalletState {
    const existing = this.get();
    if (existing) return existing;
    this.db
      .prepare(
        "INSERT INTO paper_wallet(id, starting_balance_sol, balance_sol, created_at, updated_at) VALUES (1,?,?,?,?)",
      )
      .run(startingBalanceSol, startingBalanceSol, now, now);
    return this.get()!;
  }

  get(): PaperWalletState | undefined {
    const r = this.db.prepare("SELECT * FROM paper_wallet WHERE id=1").get() as
      | Record<string, unknown>
      | undefined;
    if (!r) return undefined;
    return {
      startingBalanceSol: r.starting_balance_sol as number,
      balanceSol: r.balance_sol as number,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  setBalance(balanceSol: number, now = Date.now()): void {
    this.db.prepare("UPDATE paper_wallet SET balance_sol=?, updated_at=? WHERE id=1").run(balanceSol, now);
  }

  /** Reset the sim wallet to a fresh starting balance and clear all sim history. */
  reset(startingBalanceSol: number, now = Date.now()): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM paper_wallet").run();
      this.db.prepare("DELETE FROM paper_trades").run();
      this.db.prepare("DELETE FROM paper_positions").run();
      this.db.prepare("DELETE FROM paper_price_samples").run();
      this.db
        .prepare(
          "INSERT INTO paper_wallet(id, starting_balance_sol, balance_sol, created_at, updated_at) VALUES (1,?,?,?,?)",
        )
        .run(startingBalanceSol, startingBalanceSol, now, now);
    });
    tx();
  }

  /** Append a profit-trajectory point (PnL % vs entry) for an open paper position. */
  recordPriceSample(positionId: number, at: number, pnlPct: number): void {
    this.db.prepare("INSERT INTO paper_price_samples(position_id, at, pnl_pct) VALUES (?,?,?)").run(positionId, at, pnlPct);
  }

  /** Profit trajectories for the given positions: id → [{t, pnl}] ascending by time. */
  samplesForPositions(ids: number[]): Map<number, Array<{ t: number; pnl: number }>> {
    const out = new Map<number, Array<{ t: number; pnl: number }>>();
    if (ids.length === 0) return out;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT position_id, at, pnl_pct FROM paper_price_samples WHERE position_id IN (${placeholders}) ORDER BY at ASC`)
      .all(...ids) as Array<{ position_id: number; at: number; pnl_pct: number }>;
    for (const r of rows) {
      if (!out.has(r.position_id)) out.set(r.position_id, []);
      out.get(r.position_id)!.push({ t: r.at, pnl: r.pnl_pct });
    }
    return out;
  }

  /** Drop samples older than the cutoff (rolling-window retention). */
  pruneSamples(olderThanMs: number): void {
    this.db.prepare("DELETE FROM paper_price_samples WHERE at < ?").run(olderThanMs);
  }

  recordFill(f: PaperFill): number {
    const info = this.db
      .prepare(
        `INSERT INTO paper_trades
           (mint, side, price_usd, sol_amount, token_amount, realized_pnl_sol, remaining_token_amount, reason, at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        f.mint,
        f.side,
        f.priceUsd,
        f.solAmount,
        f.tokenAmount,
        f.realizedPnlSol,
        f.remainingTokenAmount,
        f.reason ?? null,
        f.at,
      );
    return Number(info.lastInsertRowid);
  }

  fills(limit = 200): PaperFill[] {
    const rows = this.db.prepare("SELECT * FROM paper_trades ORDER BY at DESC LIMIT ?").all(limit) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: r.id as number,
      mint: r.mint as string,
      side: r.side as "buy" | "sell",
      priceUsd: r.price_usd as number,
      solAmount: r.sol_amount as number,
      tokenAmount: r.token_amount as number,
      realizedPnlSol: r.realized_pnl_sol as number,
      remainingTokenAmount: r.remaining_token_amount as number,
      reason: (r.reason as string) ?? undefined,
      at: r.at as number,
    }));
  }

  realizedPnlSol(): number {
    const r = this.db.prepare("SELECT COALESCE(SUM(realized_pnl_sol),0) AS s FROM paper_trades").get() as {
      s: number;
    };
    return r.s;
  }
}
