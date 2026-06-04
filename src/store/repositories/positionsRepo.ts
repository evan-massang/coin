import type { DB } from "../db.js";
import type { ExitPlan, Position, PositionSource, PositionStatus } from "../../types.js";

// Generic positions persistence. Used for BOTH real observed positions
// (table `positions`, source='wallet') and paper positions (`paper_positions`,
// source='paper') — same shape, different table.

export class PositionsRepo {
  constructor(
    private readonly db: DB,
    private readonly table: "positions" | "paper_positions" = "positions",
  ) {}

  open(p: Omit<Position, "id">): number {
    const info = this.db
      .prepare(
        `INSERT INTO ${this.table}
           (mint, symbol, source, status, entry_price_usd, entry_at_ms, token_amount,
            initial_token_amount, sol_invested, cost_basis_usd, realized_pnl_usd,
            peak_price_usd, last_price_usd, exit_plan, closed_at_ms)
         VALUES (@mint,@symbol,@source,@status,@entryPriceUsd,@entryAtMs,@tokenAmount,
            @initialTokenAmount,@solInvested,@costBasisUsd,@realizedPnlUsd,
            @peakPriceUsd,@lastPriceUsd,@exitPlan,@closedAtMs)`,
      )
      .run({
        mint: p.mint,
        symbol: p.symbol ?? null,
        source: p.source,
        status: p.status,
        entryPriceUsd: p.entryPriceUsd,
        entryAtMs: p.entryAtMs,
        tokenAmount: p.tokenAmount,
        initialTokenAmount: p.initialTokenAmount,
        solInvested: p.solInvested,
        costBasisUsd: p.costBasisUsd,
        realizedPnlUsd: p.realizedPnlUsd,
        peakPriceUsd: p.peakPriceUsd,
        lastPriceUsd: p.lastPriceUsd ?? null,
        exitPlan: JSON.stringify(p.exitPlan),
        closedAtMs: p.closedAtMs ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  update(p: Position): void {
    this.db
      .prepare(
        `UPDATE ${this.table} SET
           status=@status, token_amount=@tokenAmount, realized_pnl_usd=@realizedPnlUsd,
           peak_price_usd=@peakPriceUsd, last_price_usd=@lastPriceUsd,
           exit_plan=@exitPlan, closed_at_ms=@closedAtMs
         WHERE id=@id`,
      )
      .run({
        id: p.id,
        status: p.status,
        tokenAmount: p.tokenAmount,
        realizedPnlUsd: p.realizedPnlUsd,
        peakPriceUsd: p.peakPriceUsd,
        lastPriceUsd: p.lastPriceUsd ?? null,
        exitPlan: JSON.stringify(p.exitPlan),
        closedAtMs: p.closedAtMs ?? null,
      });
  }

  get(id: number): Position | undefined {
    const row = this.db.prepare(`SELECT * FROM ${this.table} WHERE id=?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToPosition(row) : undefined;
  }

  openByMint(mint: string): Position | undefined {
    const row = this.db
      .prepare(`SELECT * FROM ${this.table} WHERE mint=? AND status!='CLOSED' ORDER BY entry_at_ms DESC LIMIT 1`)
      .get(mint) as Record<string, unknown> | undefined;
    return row ? rowToPosition(row) : undefined;
  }

  byStatus(open: boolean): Position[] {
    const clause = open ? "status!='CLOSED'" : "status='CLOSED'";
    const rows = this.db
      .prepare(`SELECT * FROM ${this.table} WHERE ${clause} ORDER BY entry_at_ms DESC`)
      .all() as Record<string, unknown>[];
    return rows.map(rowToPosition);
  }

  all(): Position[] {
    const rows = this.db.prepare(`SELECT * FROM ${this.table} ORDER BY entry_at_ms DESC`).all() as Record<
      string,
      unknown
    >[];
    return rows.map(rowToPosition);
  }

  /** Wipe the table (paper wallet reset). */
  clear(): void {
    this.db.prepare(`DELETE FROM ${this.table}`).run();
  }
}

const DEFAULT_EXIT: ExitPlan = { ladder: [], trailingStopPct: 0.35, maxHoldMs: 0 };

function rowToPosition(r: Record<string, unknown>): Position {
  let exitPlan: ExitPlan = DEFAULT_EXIT;
  if (typeof r.exit_plan === "string") {
    try {
      exitPlan = JSON.parse(r.exit_plan) as ExitPlan;
    } catch {
      /* keep default */
    }
  }
  return {
    id: r.id as number,
    mint: r.mint as string,
    symbol: (r.symbol as string) ?? undefined,
    source: r.source as PositionSource,
    status: r.status as PositionStatus,
    entryPriceUsd: r.entry_price_usd as number,
    entryAtMs: r.entry_at_ms as number,
    tokenAmount: r.token_amount as number,
    initialTokenAmount: r.initial_token_amount as number,
    solInvested: r.sol_invested as number,
    costBasisUsd: r.cost_basis_usd as number,
    realizedPnlUsd: r.realized_pnl_usd as number,
    peakPriceUsd: r.peak_price_usd as number,
    lastPriceUsd: (r.last_price_usd as number) ?? undefined,
    exitPlan,
    closedAtMs: (r.closed_at_ms as number) ?? undefined,
  };
}
