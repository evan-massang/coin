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
  /** Owning paper position (v15) — exact close-time aggregation; mint alone is
   *  ambiguous across re-entries. NULL on fills that predate the column. */
  positionId?: number;
  /** Decision provenance at buy time (e.g. "research:manus,src:scan"). */
  flags?: string;
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
           (mint, side, price_usd, sol_amount, token_amount, realized_pnl_sol, remaining_token_amount, reason, at, position_id, flags)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
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
        f.positionId ?? null,
        f.flags ?? null,
      );
    return Number(info.lastInsertRowid);
  }

  /** Every fill belonging to one position (v15+), oldest first. */
  fillsForPosition(positionId: number): PaperFill[] {
    const rows = this.db
      .prepare("SELECT * FROM paper_trades WHERE position_id=? ORDER BY at ASC")
      .all(positionId) as Record<string, unknown>[];
    return rows.map(rowToFill);
  }

  /** Worst recorded PnL% within the first `windowMs` after entry (P0: dd@5m). */
  minPnlPctWithin(positionId: number, entryAtMs: number, windowMs = 5 * 60_000): number | undefined {
    const r = this.db
      .prepare("SELECT MIN(pnl_pct) m FROM paper_price_samples WHERE position_id=? AND at <= ?")
      .get(positionId, entryAtMs + windowMs) as { m: number | null };
    return r.m ?? undefined;
  }

  /** Earliest sampled PnL% at/after `sinceMs` (velocityExit shadow's 90s base). */
  earliestPnlSince(positionId: number, sinceMs: number): number | undefined {
    const r = this.db
      .prepare("SELECT pnl_pct FROM paper_price_samples WHERE position_id=? AND at >= ? ORDER BY at ASC LIMIT 1")
      .get(positionId, sinceMs) as { pnl_pct: number } | undefined;
    return r?.pnl_pct;
  }

  /** SHADOW velocityExit: record a would-be sell. First trigger per
   *  (position, variant) wins — re-fires are ignored (UNIQUE). Never sells. */
  recordVelocityShadow(s: {
    positionId: number;
    variantPct: number;
    mint: string;
    symbol?: string;
    entryAt: number;
    triggeredAt: number;
    triggerPriceUsd: number;
    pnlPctAtTrigger: number;
    gainWindowPp: number;
    windowMs: number;
  }): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO shadow_velocity_exits
           (position_id, variant_pct, mint, symbol, entry_at, triggered_at, trigger_price_usd, pnl_pct_at_trigger, gain_window_pp, window_ms)
         VALUES (@positionId,@variantPct,@mint,@symbol,@entryAt,@triggeredAt,@triggerPriceUsd,@pnlPctAtTrigger,@gainWindowPp,@windowMs)`,
      )
      .run({ ...s, symbol: s.symbol ?? null });
    return info.changes > 0;
  }

  fillsCount(): number {
    const r = this.db.prepare("SELECT COUNT(*) n FROM paper_trades").get() as { n: number };
    return r.n;
  }

  /** Full fills dump (reset auto-export). */
  allFills(): PaperFill[] {
    const rows = this.db.prepare("SELECT * FROM paper_trades ORDER BY at ASC").all() as Record<string, unknown>[];
    return rows.map(rowToFill);
  }

  fills(limit = 200): PaperFill[] {
    const rows = this.db.prepare("SELECT * FROM paper_trades ORDER BY at DESC LIMIT ?").all(limit) as Record<
      string,
      unknown
    >[];
    return rows.map(rowToFill);
  }

  /** Simulated fills for one mint, newest first (Hermes case file). */
  fillsForMint(mint: string, limit = 100): PaperFill[] {
    const rows = this.db
      .prepare("SELECT * FROM paper_trades WHERE mint=? ORDER BY at DESC LIMIT ?")
      .all(mint, limit) as Record<string, unknown>[];
    return rows.map(rowToFill);
  }

  realizedPnlSol(): number {
    const r = this.db.prepare("SELECT COALESCE(SUM(realized_pnl_sol),0) AS s FROM paper_trades").get() as {
      s: number;
    };
    return r.s;
  }
}

function rowToFill(r: Record<string, unknown>): PaperFill {
  return {
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
    positionId: (r.position_id as number) ?? undefined,
    flags: (r.flags as string) ?? undefined,
  };
}
