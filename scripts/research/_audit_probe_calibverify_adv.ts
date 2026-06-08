import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Row = {
  at: number;
  conviction: number;
  verdict: string;
  max_gain_pct: number | null;
  hypothetical_pnl_sol: number | null;
  real_pnl_sol: number | null;
};

const all = db
  .prepare(
    `SELECT at, conviction, verdict, max_gain_pct, hypothetical_pnl_sol, real_pnl_sol
       FROM signals
      WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND conviction IS NOT NULL`,
  )
  .all() as Row[];

const mm = db.prepare(`SELECT MIN(at) mn, MAX(at) mx FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`).get() as any;
console.log(`traded BUYs total: ${all.length}`);
console.log(`at range: ${new Date(mm.mn).toISOString()} -> ${new Date(mm.mx).toISOString()}`);
const spanH = (mm.mx - mm.mn) / 3.6e6;
console.log(`span hours: ${spanH.toFixed(1)}`);

// distinct calendar days (UTC) covered
const days = new Set(all.map((r) => new Date(r.at).toISOString().slice(0, 10)));
console.log(`distinct UTC days: ${[...days].sort().join(", ")}`);

// %@59 oldest vs newest half
const sorted = [...all].sort((a, b) => a.at - b.at);
const half = Math.floor(sorted.length / 2);
const oldH = sorted.slice(0, half);
const newH = sorted.slice(half);
const pegPct = (rs: Row[]) => ((100 * rs.filter((r) => r.conviction === 59).length) / rs.length).toFixed(1);
console.log(`\n%@59 oldest half (n=${oldH.length})=${pegPct(oldH)}  newest half (n=${newH.length})=${pegPct(newH)}`);

// newest 30% regime inversion
const tail = sorted.slice(Math.floor(sorted.length * 0.7));
console.log(`\nnewest 30% n=${tail.length}  %@59=${pegPct(tail)}  range ${new Date(tail[0]!.at).toISOString()} -> ${new Date(tail[tail.length-1]!.at).toISOString()}`);
const band = (rs: Row[], lo: number, hi: number) => {
  const xs = rs.filter((r) => r.conviction >= lo && r.conviction < hi && r.max_gain_pct != null);
  const w = xs.filter((r) => (r.max_gain_pct ?? 0) >= 100).length;
  return { n: xs.length, rate: xs.length ? (100 * w) / xs.length : NaN };
};
const b59 = band(tail, 59, 60);
const b6071 = band(tail, 60, 72);
const b72 = band(tail, 72, 1e9);
console.log(`  59-band:    n=${b59.n}  2x=${b59.rate.toFixed(1)}%`);
console.log(`  60-71:      n=${b6071.n}  2x=${b6071.rate.toFixed(1)}%`);
console.log(`  72+ STRONG: n=${b72.n}  2x=${b72.rate.toFixed(1)}%`);
console.log(`  monotonic broken (59 > 60-71 > 72+)? ${b59.rate > b6071.rate && b6071.rate > b72.rate}`);

// full-history pooled monotonicity for contrast
console.log(`\nPOOLED (all history):`);
for (const [lo, hi, nm] of [[55,59,"55-58"],[59,60,"59"],[60,72,"60-71"],[72,1e9,"72+"]] as any) {
  const b = band(all, lo, hi);
  console.log(`  ${nm.padEnd(7)} n=${b.n}  2x=${b.rate.toFixed(1)}%`);
}

// PnL nullness
const withH = all.filter((r) => r.hypothetical_pnl_sol != null).length;
const withR = all.filter((r) => r.real_pnl_sol != null).length;
console.log(`\nrows with hypothetical_pnl_sol: ${withH} / ${all.length}`);
console.log(`rows with real_pnl_sol: ${withR} / ${all.length}`);

// also check the full signals table (not just traded) for hypothetical_pnl_sol presence
const allSig = db.prepare(`SELECT COUNT(*) n, COUNT(hypothetical_pnl_sol) nh, COUNT(real_pnl_sol) nr FROM signals`).get() as any;
console.log(`\nALL signals: total=${allSig.n}  withHypoPnl=${allSig.nh}  withRealPnl=${allSig.nr}`);

// Is realized PnL available anywhere? paper_trades realized_pnl_sol
try {
  const pt = db.prepare(`SELECT COUNT(*) n, COUNT(realized_pnl_sol) nr, SUM(realized_pnl_sol) s FROM paper_trades`).get() as any;
  console.log(`paper_trades: total=${pt.n}  withRealizedPnl=${pt.nr}  sumRealizedPnl=${pt.s}`);
} catch (e) { console.log("paper_trades probe failed:", (e as Error).message); }

db.close();
