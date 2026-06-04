import type { DB } from "../db.js";

// Co-occurrence edges between wallets (who buys/rugs together). Used to raise
// bundle/insider risk when a token's buyers form a known rug-prone cluster.
export class WalletClusterRepo {
  constructor(private readonly db: DB) {}

  /** Cap pair generation so a huge buyer set can't explode the edge table. */
  private pairs(addrs: string[], cap = 8): Array<[string, string]> {
    const a = [...new Set(addrs)].slice(0, cap).sort();
    const out: Array<[string, string]> = [];
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) out.push([a[i]!, a[j]!]);
    }
    return out;
  }

  recordCoBuy(addrs: string[], now = Date.now()): void {
    const stmt = this.db.prepare(
      `INSERT INTO wallet_cluster_edges(a, b, co_buys, last_at) VALUES (?,?,1,?)
       ON CONFLICT(a, b) DO UPDATE SET co_buys = co_buys + 1, last_at = excluded.last_at`,
    );
    const tx = this.db.transaction(() => {
      for (const [a, b] of this.pairs(addrs)) stmt.run(a, b, now);
    });
    tx();
  }

  recordRugOverlap(addrs: string[], now = Date.now()): void {
    const stmt = this.db.prepare(
      `INSERT INTO wallet_cluster_edges(a, b, rug_overlaps, last_at) VALUES (?,?,1,?)
       ON CONFLICT(a, b) DO UPDATE SET rug_overlaps = rug_overlaps + 1, last_at = excluded.last_at`,
    );
    const tx = this.db.transaction(() => {
      for (const [a, b] of this.pairs(addrs)) stmt.run(a, b, now);
    });
    tx();
  }

  /** Max rug-overlap count among any pair of the given wallets. */
  rugOverlap(addrs: string[]): number {
    let max = 0;
    for (const [a, b] of this.pairs(addrs)) {
      const r = this.db.prepare("SELECT rug_overlaps FROM wallet_cluster_edges WHERE a=? AND b=?").get(a, b) as
        | { rug_overlaps: number }
        | undefined;
      if (r && r.rug_overlaps > max) max = r.rug_overlaps;
    }
    return max;
  }
}
