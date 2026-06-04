import type { DB } from "../db.js";
import type { WalletScore } from "../../types.js";

// Watched wallets: the read-only observer target (kind='observer') and any
// copy-trading wallets (kind='copy').

export interface WalletRow {
  address: string;
  kind: "observer" | "copy";
  label?: string;
  addedAt: number;
  score?: WalletScore;
}

export class WalletsRepo {
  constructor(private readonly db: DB) {}

  upsert(address: string, kind: "observer" | "copy", label?: string, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO wallets(address, kind, label, added_at) VALUES (?,?,?,?)
         ON CONFLICT(address) DO UPDATE SET kind=excluded.kind, label=COALESCE(excluded.label, wallets.label)`,
      )
      .run(address, kind, label ?? null, now);
  }

  remove(address: string): void {
    this.db.prepare("DELETE FROM wallets WHERE address=?").run(address);
  }

  setScore(address: string, score: WalletScore): void {
    this.db.prepare("UPDATE wallets SET score=? WHERE address=?").run(JSON.stringify(score), address);
  }

  byKind(kind: "observer" | "copy"): WalletRow[] {
    const rows = this.db.prepare("SELECT * FROM wallets WHERE kind=? ORDER BY added_at DESC").all(kind) as Record<
      string,
      unknown
    >[];
    return rows.map(rowToWallet);
  }

  all(): WalletRow[] {
    const rows = this.db.prepare("SELECT * FROM wallets ORDER BY added_at DESC").all() as Record<string, unknown>[];
    return rows.map(rowToWallet);
  }
}

function rowToWallet(r: Record<string, unknown>): WalletRow {
  let score: WalletScore | undefined;
  if (typeof r.score === "string") {
    try {
      score = JSON.parse(r.score) as WalletScore;
    } catch {
      /* ignore */
    }
  }
  return {
    address: r.address as string,
    kind: r.kind as "observer" | "copy",
    label: (r.label as string) ?? undefined,
    addedAt: r.added_at as number,
    score,
  };
}
