import type { DB } from "../db.js";
import type { Decision, ScoreBreakdown, Verdict } from "../../types.js";
import { emptyScores } from "../../types.js";

/** A journalled signal row with parsed JSON columns (§1.10). */
export interface SignalRecord {
  id: number;
  mint: string;
  symbol?: string;
  at: number;
  verdict: Verdict;
  conviction: number;
  scores: ScoreBreakdown;
  reasons: string[];
  flags: string[];
  caps: string[];
  riskTier?: string;
  suggestedRiskPct?: number;
  maxPositionSol?: number;
  marketWeather?: string;
  sourceAgreement?: number;
  redFlags?: string[];
  priceAtAlert?: number;
  price5m?: number;
  price15m?: number;
  price1h?: number;
  maxGainPct?: number;
  maxDrawdownPct?: number;
  exitReason?: string;
  hypotheticalPnlSol?: number;
  realPnlSol?: number;
}

export interface JournalStats {
  total: number;
  byVerdict: Record<string, number>;
  winRate: number;
  avgMaxGainPct: number;
  avgMaxDrawdownPct: number;
}

/** The signal journal — every decision ever emitted, with a forward price path. */
export class SignalsRepo {
  constructor(private readonly db: DB) {}

  insert(d: Decision, priceAtAlert?: number): number {
    const info = this.db
      .prepare(
        `INSERT INTO signals(mint, symbol, at, verdict, conviction, scores, reasons, flags, caps, price_at_alert,
            risk_tier, suggested_risk_pct, max_position_sol, market_weather, source_agreement, red_flags)
         VALUES (@mint, @symbol, @at, @verdict, @conviction, @scores, @reasons, @flags, @caps, @price,
            @riskTier, @suggestedRiskPct, @maxPositionSol, @marketWeather, @sourceAgreement, @redFlags)`,
      )
      .run({
        mint: d.mint,
        symbol: d.symbol ?? null,
        at: d.at,
        verdict: d.verdict,
        conviction: d.conviction,
        scores: JSON.stringify(d.scores),
        reasons: JSON.stringify(d.reasons),
        flags: JSON.stringify(d.flags),
        caps: JSON.stringify(d.caps),
        price: priceAtAlert ?? null,
        riskTier: d.riskTier ?? null,
        suggestedRiskPct: d.suggestedRiskPct ?? null,
        maxPositionSol: d.maxPositionSol ?? null,
        marketWeather: d.marketWeather ?? null,
        sourceAgreement: d.sourceAgreement ?? null,
        redFlags: d.redFlags ? JSON.stringify(d.redFlags) : null,
      });
    return Number(info.lastInsertRowid);
  }

  updatePricePath(
    id: number,
    p: { price5m?: number; price15m?: number; price1h?: number; maxGainPct?: number; maxDrawdownPct?: number },
  ): void {
    this.db
      .prepare(
        `UPDATE signals SET
           price_5m=COALESCE(?, price_5m),
           price_15m=COALESCE(?, price_15m),
           price_1h=COALESCE(?, price_1h),
           max_gain_pct=COALESCE(?, max_gain_pct),
           max_drawdown_pct=COALESCE(?, max_drawdown_pct)
         WHERE id=?`,
      )
      .run(p.price5m ?? null, p.price15m ?? null, p.price1h ?? null, p.maxGainPct ?? null, p.maxDrawdownPct ?? null, id);
  }

  setExit(id: number, e: { exitReason?: string; hypotheticalPnlSol?: number; realPnlSol?: number }): void {
    this.db
      .prepare(
        `UPDATE signals SET
           exit_reason=COALESCE(?, exit_reason),
           hypothetical_pnl_sol=COALESCE(?, hypothetical_pnl_sol),
           real_pnl_sol=COALESCE(?, real_pnl_sol)
         WHERE id=?`,
      )
      .run(e.exitReason ?? null, e.hypotheticalPnlSol ?? null, e.realPnlSol ?? null, id);
  }

  recent(limit = 200): SignalRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM signals ORDER BY at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToSignal);
  }

  stats(): JournalStats {
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM signals").get() as { n: number }).n;
    const byRows = this.db
      .prepare("SELECT verdict, COUNT(*) AS n FROM signals GROUP BY verdict")
      .all() as { verdict: string; n: number }[];
    const byVerdict: Record<string, number> = {};
    for (const r of byRows) byVerdict[r.verdict] = r.n;

    // Win rate over signals that have a resolved max-gain path.
    const resolved = this.db
      .prepare("SELECT max_gain_pct, max_drawdown_pct FROM signals WHERE max_gain_pct IS NOT NULL")
      .all() as { max_gain_pct: number; max_drawdown_pct: number | null }[];
    const wins = resolved.filter((r) => r.max_gain_pct >= 100).length; // ≥2x = "win"
    const avgGain = avg(resolved.map((r) => r.max_gain_pct));
    const avgDraw = avg(resolved.map((r) => r.max_drawdown_pct ?? 0));

    return {
      total,
      byVerdict,
      winRate: resolved.length ? wins / resolved.length : 0,
      avgMaxGainPct: avgGain,
      avgMaxDrawdownPct: avgDraw,
    };
  }
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function parseJsonArray(v: unknown): string[] {
  if (typeof v !== "string") return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

function rowToSignal(r: Record<string, unknown>): SignalRecord {
  let scores: ScoreBreakdown = emptyScores();
  try {
    scores = { ...emptyScores(), ...(JSON.parse(r.scores as string) as ScoreBreakdown) };
  } catch {
    /* keep defaults */
  }
  return {
    id: r.id as number,
    mint: r.mint as string,
    symbol: (r.symbol as string) ?? undefined,
    at: r.at as number,
    verdict: r.verdict as Verdict,
    conviction: r.conviction as number,
    scores,
    reasons: parseJsonArray(r.reasons),
    flags: parseJsonArray(r.flags),
    caps: parseJsonArray(r.caps),
    riskTier: (r.risk_tier as string) ?? undefined,
    suggestedRiskPct: (r.suggested_risk_pct as number) ?? undefined,
    maxPositionSol: (r.max_position_sol as number) ?? undefined,
    marketWeather: (r.market_weather as string) ?? undefined,
    sourceAgreement: (r.source_agreement as number) ?? undefined,
    redFlags: parseJsonArray(r.red_flags),
    priceAtAlert: (r.price_at_alert as number) ?? undefined,
    price5m: (r.price_5m as number) ?? undefined,
    price15m: (r.price_15m as number) ?? undefined,
    price1h: (r.price_1h as number) ?? undefined,
    maxGainPct: (r.max_gain_pct as number) ?? undefined,
    maxDrawdownPct: (r.max_drawdown_pct as number) ?? undefined,
    exitReason: (r.exit_reason as string) ?? undefined,
    hypotheticalPnlSol: (r.hypothetical_pnl_sol as number) ?? undefined,
    realPnlSol: (r.real_pnl_sol as number) ?? undefined,
  };
}
