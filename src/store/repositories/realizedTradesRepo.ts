import type { DB } from "../db.js";

// P0 Measurement — the DURABLE realized-trades journal. One append-only row per
// CLOSED paper position, written at close time by PaperTrader. This is the
// single source of truth for realized paper PnL: /paper/reset never touches it,
// and UNIQUE(position_id) + INSERT OR IGNORE make double-writes impossible.
// Simulation bookkeeping only — no keys, no signing, no on-chain anything.

export interface RealizedTrade {
  id?: number;
  positionId: number;
  mint: string;
  symbol?: string;
  /** BUY_SMALL / BUY_STRONG — taken from the opening fill's reason. */
  verdict?: string;
  /** Decision provenance at buy time (e.g. "research:manus,src:scan"). */
  flags?: string;
  openedAt: number;
  closedAt: number;
  holdMs: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  /** Peak price / entry price — the exit-quality diagnostic (what was available). */
  peakMultiple?: number;
  solInvested: number;
  solReturned: number;
  realizedPnlSol: number;
  realizedPnlPct?: number;
  exitReason?: string;
  /** Worst PnL% within the first 5 minutes after entry (the hidden #1 loss driver). */
  dd5mPct?: number;
  /** 1 = fills predate the position_id column; numbers reconstructed by mint+window. */
  approx: boolean;
  createdAt: number;
}

export interface RealizedTotals {
  trades: number;
  realizedPnlSol: number;
  solInvested: number;
  wins: number;
  winRate: number;
  firstAt?: number;
  lastAt?: number;
}

export class RealizedTradesRepo {
  constructor(private readonly db: DB) {}

  /** Append a closed trade. Returns false when the position was already journaled. */
  record(t: RealizedTrade): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO realized_trades
           (position_id, mint, symbol, verdict, flags, opened_at, closed_at, hold_ms,
            entry_price_usd, exit_price_usd, peak_multiple, sol_invested, sol_returned,
            realized_pnl_sol, realized_pnl_pct, exit_reason, dd_5m_pct, approx, created_at)
         VALUES (@positionId,@mint,@symbol,@verdict,@flags,@openedAt,@closedAt,@holdMs,
            @entryPriceUsd,@exitPriceUsd,@peakMultiple,@solInvested,@solReturned,
            @realizedPnlSol,@realizedPnlPct,@exitReason,@dd5mPct,@approx,@createdAt)`,
      )
      .run({
        positionId: t.positionId,
        mint: t.mint,
        symbol: t.symbol ?? null,
        verdict: t.verdict ?? null,
        flags: t.flags ?? null,
        openedAt: t.openedAt,
        closedAt: t.closedAt,
        holdMs: t.holdMs,
        entryPriceUsd: t.entryPriceUsd ?? null,
        exitPriceUsd: t.exitPriceUsd ?? null,
        peakMultiple: t.peakMultiple ?? null,
        solInvested: t.solInvested,
        solReturned: t.solReturned,
        realizedPnlSol: t.realizedPnlSol,
        realizedPnlPct: t.realizedPnlPct ?? null,
        exitReason: t.exitReason ?? null,
        dd5mPct: t.dd5mPct ?? null,
        approx: t.approx ? 1 : 0,
        createdAt: t.createdAt,
      });
    return info.changes > 0;
  }

  recent(limit = 50): RealizedTrade[] {
    const rows = this.db
      .prepare("SELECT * FROM realized_trades ORDER BY closed_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToTrade);
  }

  forPositions(ids: number[]): Map<number, RealizedTrade> {
    const out = new Map<number, RealizedTrade>();
    if (ids.length === 0) return out;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM realized_trades WHERE position_id IN (${placeholders})`)
      .all(...ids) as Record<string, unknown>[];
    for (const r of rows) {
      const t = rowToTrade(r);
      out.set(t.positionId, t);
    }
    return out;
  }

  /** Realized equity curve: cumulative realized SOL per close, oldest first. */
  equityCurve(sinceMs = 0): Array<{ t: number; pnlSol: number; cumSol: number }> {
    const rows = this.db
      .prepare("SELECT closed_at, realized_pnl_sol FROM realized_trades WHERE closed_at >= ? ORDER BY closed_at ASC")
      .all(sinceMs) as Array<{ closed_at: number; realized_pnl_sol: number }>;
    let cum = 0;
    return rows.map((r) => {
      cum += r.realized_pnl_sol;
      return { t: r.closed_at, pnlSol: r.realized_pnl_sol, cumSol: cum };
    });
  }

  totals(sinceMs = 0): RealizedTotals {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(realized_pnl_sol),0) pnl, COALESCE(SUM(sol_invested),0) inv,
                SUM(CASE WHEN realized_pnl_sol > 0 THEN 1 ELSE 0 END) wins,
                MIN(closed_at) first_at, MAX(closed_at) last_at
         FROM realized_trades WHERE closed_at >= ?`,
      )
      .get(sinceMs) as Record<string, number | null>;
    const n = Number(r.n) || 0;
    const wins = Number(r.wins) || 0;
    return {
      trades: n,
      realizedPnlSol: Number(r.pnl) || 0,
      solInvested: Number(r.inv) || 0,
      wins,
      winRate: n ? wins / n : 0,
      firstAt: r.first_at == null ? undefined : Number(r.first_at),
      lastAt: r.last_at == null ? undefined : Number(r.last_at),
    };
  }

  /** Reset audit log (durable, like the journal). */
  recordReset(r: {
    at: number;
    exportPath?: string;
    balanceSol?: number;
    startingBalanceSol?: number;
    equitySol?: number;
    openCount?: number;
    closedCount?: number;
    fillsCount?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO paper_resets(at, export_path, balance_sol, starting_balance_sol, equity_sol, open_count, closed_count, fills_count)
         VALUES (@at,@exportPath,@balanceSol,@startingBalanceSol,@equitySol,@openCount,@closedCount,@fillsCount)`,
      )
      .run({
        at: r.at,
        exportPath: r.exportPath ?? null,
        balanceSol: r.balanceSol ?? null,
        startingBalanceSol: r.startingBalanceSol ?? null,
        equitySol: r.equitySol ?? null,
        openCount: r.openCount ?? null,
        closedCount: r.closedCount ?? null,
        fillsCount: r.fillsCount ?? null,
      });
  }

  lastResetAt(): number | undefined {
    const r = this.db.prepare("SELECT MAX(at) m FROM paper_resets").get() as { m: number | null };
    return r.m ?? undefined;
  }
}

function rowToTrade(r: Record<string, unknown>): RealizedTrade {
  return {
    id: r.id as number,
    positionId: r.position_id as number,
    mint: r.mint as string,
    symbol: (r.symbol as string) ?? undefined,
    verdict: (r.verdict as string) ?? undefined,
    flags: (r.flags as string) ?? undefined,
    openedAt: r.opened_at as number,
    closedAt: r.closed_at as number,
    holdMs: r.hold_ms as number,
    entryPriceUsd: (r.entry_price_usd as number) ?? undefined,
    exitPriceUsd: (r.exit_price_usd as number) ?? undefined,
    peakMultiple: (r.peak_multiple as number) ?? undefined,
    solInvested: r.sol_invested as number,
    solReturned: r.sol_returned as number,
    realizedPnlSol: r.realized_pnl_sol as number,
    realizedPnlPct: (r.realized_pnl_pct as number) ?? undefined,
    exitReason: (r.exit_reason as string) ?? undefined,
    dd5mPct: (r.dd_5m_pct as number) ?? undefined,
    approx: Boolean(r.approx),
    createdAt: r.created_at as number,
  };
}
