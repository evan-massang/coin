import type { DB } from "../db.js";
import type { Mission } from "../../research/mission.types.js";

// Durable store for Project Hermes missions (the Manus mission board). A mission
// is created OPEN; when a recommendation comes back it is stored + marked
// RESOLVED. The recommendation also flows through AttentionService.injectResult
// so it re-scores the coin through decide() — this table is the audit trail, not
// an execution path.

export type MissionStatus = "open" | "resolved" | "cancelled";

export interface MissionResult {
  recommendation: "confirm" | "caution" | "unsure" | "avoid";
  /** 0..100. */
  confidence: number;
  /** Optional explicit attention sub-scores (else derived from the recommendation). */
  scores?: { humanity?: number; virality?: number; outsideCrypto?: number; culturalStrength?: number; attention?: number };
  narrative?: string;
  reasons?: string[];
  /** Who answered ("manus", "manus-board", …). */
  provider?: string;
}

export interface MissionRow {
  id: number;
  mint: string;
  symbol?: string;
  verdict?: string;
  conviction?: number;
  status: MissionStatus;
  mission: Mission;
  result?: MissionResult;
  provider?: string;
  createdAt: number;
  resolvedAt?: number;
}

export class MissionRepo {
  constructor(private readonly db: DB) {}

  insert(m: Mission): number {
    const info = this.db
      .prepare(
        `INSERT INTO missions(mint, symbol, verdict, conviction, status, mission_json, created_at)
         VALUES (@mint, @symbol, @verdict, @conviction, 'open', @missionJson, @createdAt)`,
      )
      .run({
        mint: m.mint,
        symbol: m.symbol ?? null,
        verdict: m.verdict,
        conviction: m.conviction,
        missionJson: JSON.stringify(m),
        createdAt: m.createdAt,
      });
    return Number(info.lastInsertRowid);
  }

  get(id: number): MissionRow | undefined {
    const r = this.db.prepare("SELECT * FROM missions WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return r ? rowToMission(r) : undefined;
  }

  recent(limit = 50): MissionRow[] {
    const rows = this.db.prepare("SELECT * FROM missions ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(rowToMission);
  }

  /** Every mission for one mint, newest first (Hermes case file). */
  forMint(mint: string, limit = 50): MissionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM missions WHERE mint=? ORDER BY created_at DESC LIMIT ?")
      .all(mint, limit) as Record<string, unknown>[];
    return rows.map(rowToMission);
  }

  /** Open missions, newest first (the operator's to-do queue). */
  open(limit = 50): MissionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM missions WHERE status='open' ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToMission);
  }

  setResult(id: number, result: MissionResult, resolvedAt: number): void {
    this.db
      .prepare(`UPDATE missions SET result_json=?, provider=?, status='resolved', resolved_at=? WHERE id=?`)
      .run(JSON.stringify(result), result.provider ?? "manus", resolvedAt, id);
  }

  cancel(id: number): void {
    this.db.prepare(`UPDATE missions SET status='cancelled' WHERE id=? AND status='open'`).run(id);
  }
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function rowToMission(r: Record<string, unknown>): MissionRow {
  return {
    id: r.id as number,
    mint: r.mint as string,
    symbol: (r.symbol as string) ?? undefined,
    verdict: (r.verdict as string) ?? undefined,
    conviction: (r.conviction as number) ?? undefined,
    status: r.status as MissionStatus,
    mission: parseJson(r.mission_json, {} as Mission),
    result: r.result_json ? parseJson<MissionResult | undefined>(r.result_json, undefined) : undefined,
    provider: (r.provider as string) ?? undefined,
    createdAt: r.created_at as number,
    resolvedAt: (r.resolved_at as number) ?? undefined,
  };
}
