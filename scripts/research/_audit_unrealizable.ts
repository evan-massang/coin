/**
 * READ-ONLY: verify the audit's linchpin claims.
 *  (a) Do 2x-winners first breach the -45% stop? (peak target is unrealizable)
 *  (b) Does the -45% stop realize near -65% (gaps on a stale 5m aggregate)?
 *  (c) Is conviction inversely related to realized 5m return?
 *   npx tsx scripts/research/_audit_unrealizable.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Row = { verdict: string; conviction: number | null; price_at_alert: number | null; price_5m: number | null; max_gain_pct: number | null; max_drawdown_pct: number | null };
const buys = db.prepare(
  `SELECT verdict, conviction, price_at_alert, price_5m, max_gain_pct, max_drawdown_pct FROM signals
    WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL`,
).all() as Row[];

const winners = buys.filter((r) => (r.max_gain_pct ?? 0) >= 100);
const winnersDD45 = winners.filter((r) => (r.max_drawdown_pct ?? 0) >= 45);
console.log(`resolved BUYs: ${buys.length}  2x-winners(peak>=100%): ${winners.length}`);
console.log(`(a) winners that ALSO had max_drawdown>=45% (would breach the -45% stop): ${winnersDD45.length}/${winners.length} (${winners.length ? ((winnersDD45.length / winners.length) * 100).toFixed(1) : "0"}%)`);

// (b) among losers that breached -45% drawdown, where did 5m actually sit? (stop-gap proxy)
const ddBreach = buys.filter((r) => (r.max_drawdown_pct ?? 0) >= 45 && r.price_at_alert && r.price_5m != null);
const ret5OnBreach = ddBreach.map((r) => ((r.price_5m! - r.price_at_alert!) / r.price_at_alert!) * 100).sort((a, b) => a - b);
const med = ret5OnBreach.length ? ret5OnBreach[Math.floor(ret5OnBreach.length / 2)] : null;
console.log(`(b) of ${ddBreach.length} BUYs with >=45% drawdown, median 5m return: ${med != null ? med.toFixed(1) + "%" : "n/a"} (how deep the 5m gap is vs the -45% stop)`);

// (c) conviction vs realized 5m return buckets
const withRet = buys.filter((r) => r.price_at_alert && r.price_5m != null && r.conviction != null)
  .map((r) => ({ c: r.conviction!, ret: ((r.price_5m! - r.price_at_alert!) / r.price_at_alert!) * 100, peak: r.max_gain_pct ?? 0 }));
const bucket = (lo: number, hi: number) => {
  const b = withRet.filter((x) => x.c >= lo && x.c < hi);
  const mean = b.length ? b.reduce((s, x) => s + x.ret, 0) / b.length : 0;
  const win2x = b.filter((x) => x.peak >= 100).length;
  return `conv[${lo},${hi}): n=${b.length} meanRet5m=${mean.toFixed(1)}% peak2xRate=${b.length ? ((win2x / b.length) * 100).toFixed(1) : "0"}%`;
};
console.log("(c) realized-5m + peak-2x by conviction bucket:");
console.log("    " + bucket(55, 60));
console.log("    " + bucket(60, 72));
console.log("    " + bucket(72, 101));
db.close();
