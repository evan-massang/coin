import type { DB } from "../db.js";
import type {
  BacktestRun,
  FeatureRecord,
  ScoreBreakdown,
  SettingChange,
  Suggestion,
  Verdict,
} from "../../types.js";
import { emptyScores } from "../../types.js";

// Persistence for the learning loop (§1.12–1.13): feature store, threshold
// suggestions, backtest runs, and the setting-change audit log.

export class LearningRepo {
  constructor(private readonly db: DB) {}

  // ── Feature store ──
  addFeature(f: FeatureRecord): number {
    const info = this.db
      .prepare(
        `INSERT INTO learning_features
           (mint, at, verdict, scores, entry_price_usd, exit_price_usd, max_gain_pct,
            max_drawdown_pct, hold_ms, exit_reason, realized_pnl_sol, source)
         VALUES (@mint,@at,@verdict,@scores,@entry,@exit,@gain,@draw,@hold,@reason,@pnl,@source)`,
      )
      .run({
        mint: f.mint,
        at: f.at,
        verdict: f.verdict,
        scores: JSON.stringify(f.scores),
        entry: f.entryPriceUsd ?? null,
        exit: f.exitPriceUsd ?? null,
        gain: f.maxGainPct ?? null,
        draw: f.maxDrawdownPct ?? null,
        hold: f.holdMs ?? null,
        reason: f.exitReason ?? null,
        pnl: f.realizedPnlSol ?? null,
        source: f.source,
      });
    return Number(info.lastInsertRowid);
  }

  features(limit = 5000): FeatureRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM learning_features ORDER BY at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToFeature);
  }

  // ── Suggestions ──
  addSuggestion(s: Suggestion): number {
    const info = this.db
      .prepare(
        "INSERT INTO learning_suggestions(at, kind, setting, from_val, to_val, rationale, status) VALUES (?,?,?,?,?,?,?)",
      )
      .run(s.at, s.kind, s.setting, s.from, s.to, s.rationale, s.status);
    return Number(info.lastInsertRowid);
  }

  pendingSuggestions(): Suggestion[] {
    return this.suggestionsWhere("status='pending'");
  }

  allSuggestions(limit = 200): Suggestion[] {
    return this.suggestionsWhere("1=1", limit);
  }

  private suggestionsWhere(clause: string, limit = 200): Suggestion[] {
    const rows = this.db
      .prepare(`SELECT * FROM learning_suggestions WHERE ${clause} ORDER BY at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      at: r.at as number,
      kind: r.kind as string,
      setting: r.setting as string,
      from: r.from_val as number,
      to: r.to_val as number,
      rationale: r.rationale as string,
      status: r.status as Suggestion["status"],
    }));
  }

  setSuggestionStatus(id: number, status: Suggestion["status"]): void {
    this.db.prepare("UPDATE learning_suggestions SET status=? WHERE id=?").run(status, id);
  }

  getSuggestion(id: number): Suggestion | undefined {
    return this.suggestionsWhere(`id=${Number(id)}`)[0];
  }

  // ── Backtests ──
  addBacktest(b: BacktestRun): number {
    const info = this.db
      .prepare(
        `INSERT INTO backtest_runs
           (at, settings, trades, win_rate, total_pnl_sol, max_drawdown_pct, best_trade_pct, worst_trade_pct, avg_hold_ms)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        b.at,
        JSON.stringify(b.settings),
        b.trades,
        b.winRate,
        b.totalPnlSol,
        b.maxDrawdownPct,
        b.bestTradePct,
        b.worstTradePct,
        b.avgHoldMs,
      );
    return Number(info.lastInsertRowid);
  }

  backtests(limit = 50): BacktestRun[] {
    const rows = this.db.prepare("SELECT * FROM backtest_runs ORDER BY at DESC LIMIT ?").all(limit) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: r.id as number,
      at: r.at as number,
      settings: safeJson(r.settings) as Record<string, number>,
      trades: r.trades as number,
      winRate: r.win_rate as number,
      totalPnlSol: r.total_pnl_sol as number,
      maxDrawdownPct: r.max_drawdown_pct as number,
      bestTradePct: r.best_trade_pct as number,
      worstTradePct: r.worst_trade_pct as number,
      avgHoldMs: r.avg_hold_ms as number,
    }));
  }

  // ── Change log (read; writes happen in SettingsStore) ──
  changeLog(limit = 200): SettingChange[] {
    const rows = this.db
      .prepare("SELECT * FROM setting_change_log ORDER BY at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      at: r.at as number,
      setting: r.setting as string,
      from: r.from_val as string,
      to: r.to_val as string,
      by: r.by as "user" | "auto",
      note: (r.note as string) ?? undefined,
    }));
  }

  /** Count of auto-applied changes since `sinceMs` — used to enforce the daily auto-tune rail. */
  autoChangesSince(sinceMs: number): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM setting_change_log WHERE by='auto' AND at>=?")
      .get(sinceMs) as { n: number };
    return r.n;
  }
}

function safeJson(v: unknown): unknown {
  if (typeof v !== "string") return {};
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}

function rowToFeature(r: Record<string, unknown>): FeatureRecord {
  let scores: ScoreBreakdown = emptyScores();
  try {
    scores = { ...emptyScores(), ...(JSON.parse(r.scores as string) as ScoreBreakdown) };
  } catch {
    /* defaults */
  }
  return {
    id: r.id as number,
    mint: r.mint as string,
    at: r.at as number,
    verdict: r.verdict as Verdict,
    scores,
    entryPriceUsd: (r.entry_price_usd as number) ?? undefined,
    exitPriceUsd: (r.exit_price_usd as number) ?? undefined,
    maxGainPct: (r.max_gain_pct as number) ?? undefined,
    maxDrawdownPct: (r.max_drawdown_pct as number) ?? undefined,
    holdMs: (r.hold_ms as number) ?? undefined,
    exitReason: (r.exit_reason as string) ?? undefined,
    realizedPnlSol: (r.realized_pnl_sol as number) ?? undefined,
    source: r.source as FeatureRecord["source"],
  };
}
