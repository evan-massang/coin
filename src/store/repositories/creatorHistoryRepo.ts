import type { DB } from "../db.js";

export interface CreatorStats {
  creator: string;
  launches: number;
  rugs: number;
  winners: number;
  firstSeen: number;
  lastSeen: number;
}

/** Per-deployer launch/rug/winner history (scam memory). */
export class CreatorHistoryRepo {
  constructor(private readonly db: DB) {}

  recordLaunch(creator: string, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO creator_history(creator, launches, first_seen, last_seen) VALUES (?,1,?,?)
         ON CONFLICT(creator) DO UPDATE SET launches = launches + 1, last_seen = excluded.last_seen`,
      )
      .run(creator, now, now);
  }

  recordOutcome(creator: string, outcome: "rug" | "winner"): void {
    const col = outcome === "rug" ? "rugs" : "winners";
    this.db.prepare(`UPDATE creator_history SET ${col} = ${col} + 1 WHERE creator=?`).run(creator);
  }

  get(creator: string): CreatorStats | undefined {
    const r = this.db.prepare("SELECT * FROM creator_history WHERE creator=?").get(creator) as
      | Record<string, unknown>
      | undefined;
    if (!r) return undefined;
    return {
      creator: r.creator as string,
      launches: r.launches as number,
      rugs: r.rugs as number,
      winners: r.winners as number,
      firstSeen: r.first_seen as number,
      lastSeen: r.last_seen as number,
    };
  }
}
