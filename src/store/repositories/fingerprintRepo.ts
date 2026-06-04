import type { DB } from "../db.js";
import type { Fingerprint } from "../../graph/tokenSimilarity.js";

/** Token fingerprints + their eventual outcome (for rug-relaunch detection). */
export class FingerprintRepo {
  constructor(private readonly db: DB) {}

  record(mint: string, fp: Fingerprint, now = Date.now()): void {
    this.db
      .prepare("INSERT INTO token_fingerprints(mint, fingerprint, norm_name, symbol, at) VALUES (?,?,?,?,?)")
      .run(mint, fp.hash, fp.normName, fp.symbol, now);
  }

  markOutcome(mint: string, outcome: "rug" | "winner"): void {
    this.db.prepare("UPDATE token_fingerprints SET outcome=? WHERE mint=?").run(outcome, mint);
  }

  /** Count past WINNER tokens sharing this normalized name (graph evidence). */
  similarWinners(normName: string): number {
    if (!normName || normName.length < 3) return 0;
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM token_fingerprints WHERE outcome='winner' AND norm_name=?")
      .get(normName) as { n: number };
    return r.n;
  }

  /** Fingerprints of tokens that ended as rugs (for similarity matching). */
  pastRugs(limit = 1000): Fingerprint[] {
    const rows = this.db
      .prepare("SELECT fingerprint, norm_name, symbol FROM token_fingerprints WHERE outcome='rug' ORDER BY at DESC LIMIT ?")
      .all(limit) as Array<{ fingerprint: string; norm_name: string | null; symbol: string | null }>;
    return rows.map((r) => ({ hash: r.fingerprint, normName: r.norm_name ?? "", symbol: r.symbol ?? "", uriDomain: "" }));
  }
}
