import type { DB } from "../db.js";

// Council journal (Phase 6/7/9): every seat's opinion is recorded, later resolved
// against the token's real outcome, and turned into per-seat accuracy + bounded
// dynamic weights. Purely advisory bookkeeping — it never moves the decision.

export interface CouncilOpinionInput {
  at: number;
  mint: string;
  symbol?: string;
  memberId: string;
  label: string;
  role: string;
  model?: string;
  score: number;
  recommendation: "confirm" | "caution";
  rationale: string;
}

export interface CouncilOpinionRow extends CouncilOpinionInput {
  id: number;
  outcome?: "win" | "loss";
  maxGainPct?: number;
}

export interface MemberStat {
  memberId: string;
  label: string;
  role: string;
  total: number;
  resolved: number;
  wins: number;
  accuracy: number; // correct / resolved
  avgConfidence: number;
  falsePositives: number; // confirm → loss
  falseNegatives: number; // caution → win
  weight: number; // bounded dynamic weight
}

const MIN_RESOLVED_FOR_WEIGHT = 8;

export class CouncilRepo {
  constructor(private readonly db: DB) {}

  record(o: CouncilOpinionInput): void {
    this.db
      .prepare(
        `INSERT INTO council_opinions(at, mint, symbol, member_id, label, role, model, score, recommendation, rationale)
         VALUES (@at,@mint,@symbol,@memberId,@label,@role,@model,@score,@recommendation,@rationale)`,
      )
      .run({
        at: o.at, mint: o.mint, symbol: o.symbol ?? null, memberId: o.memberId, label: o.label,
        role: o.role, model: o.model ?? null, score: o.score, recommendation: o.recommendation, rationale: o.rationale,
      });
  }

  /** Mark every still-unresolved opinion for a mint with the realised outcome. */
  resolve(mint: string, outcome: "win" | "loss", maxGainPct?: number): number {
    const info = this.db
      .prepare("UPDATE council_opinions SET outcome=?, max_gain_pct=? WHERE mint=? AND outcome IS NULL")
      .run(outcome, maxGainPct ?? null, mint);
    return info.changes;
  }

  recent(limit = 50): CouncilOpinionRow[] {
    const rows = this.db.prepare("SELECT * FROM council_opinions ORDER BY at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(rowToOpinion);
  }

  /** Per-seat accuracy + a bounded dynamic weight (equal until enough samples). */
  memberStats(): MemberStat[] {
    const rows = this.db
      .prepare(
        `SELECT member_id, label, role,
                COUNT(*) AS total,
                SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
                SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN (recommendation='confirm' AND outcome='win') OR (recommendation='caution' AND outcome='loss') THEN 1 ELSE 0 END) AS correct,
                SUM(CASE WHEN recommendation='confirm' AND outcome='loss' THEN 1 ELSE 0 END) AS fp,
                SUM(CASE WHEN recommendation='caution' AND outcome='win' THEN 1 ELSE 0 END) AS fn,
                AVG(score) AS avg_score
         FROM council_opinions GROUP BY member_id, label, role`,
      )
      .all() as Array<Record<string, number | string | null>>;
    return rows.map((r) => {
      const resolved = Number(r.resolved) || 0;
      const correct = Number(r.correct) || 0;
      const accuracy = resolved ? correct / resolved : 0;
      const weight = resolved >= MIN_RESOLVED_FOR_WEIGHT ? clamp(accuracy * 1.5 + 0.25, 0.4, 1.6) : 1;
      return {
        memberId: String(r.member_id),
        label: String(r.label ?? r.member_id),
        role: String(r.role ?? ""),
        total: Number(r.total) || 0,
        resolved,
        wins: Number(r.wins) || 0,
        accuracy,
        avgConfidence: Math.round(Number(r.avg_score) || 0),
        falsePositives: Number(r.fp) || 0,
        falseNegatives: Number(r.fn) || 0,
        weight,
      };
    });
  }

  /** Map of member id → bounded weight for the consensus engine. */
  weights(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.memberStats()) out[s.memberId] = s.weight;
    return out;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function rowToOpinion(r: Record<string, unknown>): CouncilOpinionRow {
  return {
    id: r.id as number,
    at: r.at as number,
    mint: r.mint as string,
    symbol: (r.symbol as string) ?? undefined,
    memberId: r.member_id as string,
    label: (r.label as string) ?? "",
    role: (r.role as string) ?? "",
    model: (r.model as string) ?? undefined,
    score: r.score as number,
    recommendation: (r.recommendation as "confirm" | "caution") ?? "caution",
    rationale: (r.rationale as string) ?? "",
    outcome: (r.outcome as "win" | "loss") ?? undefined,
    maxGainPct: (r.max_gain_pct as number) ?? undefined,
  };
}
