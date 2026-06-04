import type { DB } from "../db.js";
import type { NewToken, MarketSnapshot } from "../../types.js";

/** Persistence for discovered tokens + their latest market snapshot. */
export class TokensRepo {
  constructor(private readonly db: DB) {}

  upsert(t: NewToken): void {
    this.db
      .prepare(
        `INSERT INTO tokens(mint, name, symbol, creator, uri, pool, created_at, first_seen_at)
         VALUES (@mint, @name, @symbol, @creator, @uri, @pool, @createdAt, @seenAt)
         ON CONFLICT(mint) DO UPDATE SET
           name=COALESCE(excluded.name, tokens.name),
           symbol=COALESCE(excluded.symbol, tokens.symbol)`,
      )
      .run({
        mint: t.mint,
        name: t.name ?? null,
        symbol: t.symbol ?? null,
        creator: t.creator ?? null,
        uri: t.uri ?? null,
        pool: t.pool ?? null,
        createdAt: t.seenAt,
        seenAt: t.seenAt,
      });
  }

  saveSnapshot(snap: MarketSnapshot): void {
    this.db
      .prepare("UPDATE tokens SET last_snapshot=? WHERE mint=?")
      .run(JSON.stringify(snap), snap.mint);
  }

  get(mint: string): { mint: string; name?: string; symbol?: string; creator?: string } | undefined {
    const row = this.db
      .prepare("SELECT mint, name, symbol, creator FROM tokens WHERE mint=?")
      .get(mint) as { mint: string; name: string | null; symbol: string | null; creator: string | null } | undefined;
    if (!row) return undefined;
    return {
      mint: row.mint,
      name: row.name ?? undefined,
      symbol: row.symbol ?? undefined,
      creator: row.creator ?? undefined,
    };
  }

  lastSnapshot(mint: string): MarketSnapshot | undefined {
    const row = this.db.prepare("SELECT last_snapshot FROM tokens WHERE mint=?").get(mint) as
      | { last_snapshot: string | null }
      | undefined;
    if (!row?.last_snapshot) return undefined;
    try {
      return JSON.parse(row.last_snapshot) as MarketSnapshot;
    } catch {
      return undefined;
    }
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM tokens").get() as { n: number }).n;
  }
}
