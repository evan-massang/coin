import type { DB } from "../store/db.js";
import type { ScoreBreakdown, Verdict } from "../types.js";
import { emptyScores } from "../types.js";

// Records resolved signal events for deterministic replay (§Phase 6). One row
// per resolved signal: the scores + safety facts + the realised price path.
export interface ReplayEvent {
  mint: string;
  at: number;
  verdict: Verdict;
  scores: ScoreBreakdown;
  safetyPass: boolean;
  unknownCount: number;
  maxGainPct?: number;
  maxDrawdownPct?: number;
  holdMs?: number;
}

export class EventRecorder {
  constructor(private readonly db: DB) {}

  record(e: ReplayEvent): void {
    this.db
      .prepare(
        `INSERT INTO replay_events(mint, at, verdict, scores, safety_pass, unknown_count, max_gain_pct, max_drawdown_pct, hold_ms)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.mint,
        e.at,
        e.verdict,
        JSON.stringify(e.scores),
        e.safetyPass ? 1 : 0,
        e.unknownCount,
        e.maxGainPct ?? null,
        e.maxDrawdownPct ?? null,
        e.holdMs ?? null,
      );
  }

  list(fromMs = 0, toMs = Number.MAX_SAFE_INTEGER, limit = 10_000): ReplayEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM replay_events WHERE at>=? AND at<=? ORDER BY at ASC LIMIT ?")
      .all(fromMs, toMs, limit) as Record<string, unknown>[];
    return rows.map((r) => {
      let scores: ScoreBreakdown = emptyScores();
      try {
        scores = { ...emptyScores(), ...(JSON.parse(r.scores as string) as ScoreBreakdown) };
      } catch {
        /* defaults */
      }
      return {
        mint: r.mint as string,
        at: r.at as number,
        verdict: r.verdict as Verdict,
        scores,
        safetyPass: (r.safety_pass as number) === 1,
        unknownCount: r.unknown_count as number,
        maxGainPct: (r.max_gain_pct as number) ?? undefined,
        maxDrawdownPct: (r.max_drawdown_pct as number) ?? undefined,
        holdMs: (r.hold_ms as number) ?? undefined,
      };
    });
  }
}
