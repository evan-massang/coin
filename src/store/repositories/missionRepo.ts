import type { DB } from "../db.js";
import type { Mission } from "../../research/mission.types.js";

// Durable store for Project Hermes missions (the Manus mission board). A mission
// is created OPEN; when a recommendation comes back it is stored + marked
// RESOLVED. The recommendation also flows through AttentionService.injectResult
// so it re-scores the coin through decide() — this table is the audit trail, not
// an execution path.

export type MissionStatus = "open" | "sent" | "resolved" | "cancelled" | "failed";
export type MissionKind = "research" | "discovery" | "deepdive";

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
  kind: MissionKind;
  mission: Mission;
  result?: MissionResult;
  /** Raw structured payload for discovery/deepdive missions (candidates/results). */
  resultRaw?: unknown;
  provider?: string;
  createdAt: number;
  resolvedAt?: number;
  /** Remote task id (Manus task_id) when dispatched via the API. */
  externalId?: string;
  /** Remote task URL — the operator's "watch Manus live" link. */
  externalUrl?: string;
  sentAt?: number;
  error?: string;
}

export class MissionRepo {
  constructor(private readonly db: DB) {}

  insert(m: Mission, kind: MissionKind = "research"): number {
    const info = this.db
      .prepare(
        `INSERT INTO missions(mint, symbol, verdict, conviction, status, kind, mission_json, created_at)
         VALUES (@mint, @symbol, @verdict, @conviction, 'open', @kind, @missionJson, @createdAt)`,
      )
      .run({
        mint: m.mint,
        symbol: m.symbol ?? null,
        verdict: m.verdict,
        conviction: m.conviction,
        kind,
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

  /** Resolve a mission. Guarded: only an OPEN or SENT mission can be resolved —
   *  a resolved mission can never be re-resolved/re-injected (red-team finding). */
  setResult(id: number, result: MissionResult, resolvedAt: number): boolean {
    const info = this.db
      .prepare(`UPDATE missions SET result_json=?, provider=?, status='resolved', resolved_at=? WHERE id=? AND status IN ('open','sent')`)
      .run(JSON.stringify(result), result.provider ?? "manus", resolvedAt, id);
    return info.changes > 0;
  }

  /** Mark a mission dispatched to a remote provider (Manus task created). */
  setSent(id: number, externalId: string, externalUrl: string | undefined, at: number): boolean {
    const info = this.db
      .prepare(`UPDATE missions SET status='sent', external_id=?, external_url=?, sent_at=?, provider='manus' WHERE id=? AND status='open'`)
      .run(externalId, externalUrl ?? null, at, id);
    return info.changes > 0;
  }

  /** Record a dispatch/poll failure (audit trail; mission leaves the poll set). */
  markFailed(id: number, reason: string, at: number): boolean {
    const info = this.db
      .prepare(`UPDATE missions SET status='failed', error=?, resolved_at=? WHERE id=? AND status IN ('open','sent')`)
      .run(reason.slice(0, 500), at, id);
    return info.changes > 0;
  }

  /** Missions awaiting a remote result (the poll set), oldest first. */
  sentMissions(limit = 50): MissionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM missions WHERE status='sent' ORDER BY sent_at ASC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToMission);
  }

  /** Remote dispatches in a window — the auto-mission hourly cap. */
  countSentSince(ts: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM missions WHERE sent_at IS NOT NULL AND sent_at >= ?").get(ts) as { n: number }).n;
  }

  /** Store a raw structured payload (discovery/deepdive) — same status guard as setResult. */
  setResultRaw(id: number, payload: unknown, provider: string, resolvedAt: number): boolean {
    const info = this.db
      .prepare(`UPDATE missions SET result_json=?, provider=?, status='resolved', resolved_at=? WHERE id=? AND status IN ('open','sent')`)
      .run(JSON.stringify(payload), provider, resolvedAt, id);
    return info.changes > 0;
  }

  /** Newest mission of a kind (discovery cadence check). */
  latestByKind(kind: MissionKind): MissionRow | undefined {
    const r = this.db
      .prepare("SELECT * FROM missions WHERE kind=? ORDER BY created_at DESC LIMIT 1")
      .get(kind) as Record<string, unknown> | undefined;
    return r ? rowToMission(r) : undefined;
  }

  /** Any mission of this kind still open or awaiting a remote result? */
  hasActiveOfKind(kind: MissionKind): boolean {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM missions WHERE kind=? AND status IN ('open','sent')")
      .get(kind) as { n: number };
    return r.n > 0;
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
  const kind = ((r.kind as string) || "research") as MissionKind;
  const rawResult = r.result_json ? parseJson<unknown>(r.result_json, undefined) : undefined;
  return {
    id: r.id as number,
    mint: r.mint as string,
    symbol: (r.symbol as string) ?? undefined,
    verdict: (r.verdict as string) ?? undefined,
    conviction: (r.conviction as number) ?? undefined,
    status: r.status as MissionStatus,
    kind,
    mission: parseJson(r.mission_json, {} as Mission),
    result: kind === "research" ? (rawResult as MissionResult | undefined) : undefined,
    resultRaw: kind === "research" ? undefined : rawResult,
    provider: (r.provider as string) ?? undefined,
    createdAt: r.created_at as number,
    resolvedAt: (r.resolved_at as number) ?? undefined,
    externalId: (r.external_id as string) ?? undefined,
    externalUrl: (r.external_url as string) ?? undefined,
    sentAt: (r.sent_at as number) ?? undefined,
    error: (r.error as string) ?? undefined,
  };
}
