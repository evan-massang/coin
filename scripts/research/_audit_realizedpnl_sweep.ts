/**
 * READ-ONLY: realized-PnL policy sweep over recorded BUYs.
 * Entry filter (by recorded conviction) x Exit model (ladder/stop/trail), scored
 * with exitOutcomeBounds (honest peak-first / trough-first bounds). Goal: find the
 * policy that turns the current bleed into the best realized PnL.
 *   npx tsx scripts/research/_audit_realizedpnl_sweep.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { exitOutcomeBounds, type ExitModel } from "../../src/learning/backtester.js";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
type Row = { verdict: string; conviction: number | null; max_gain_pct: number | null; max_drawdown_pct: number | null };
const buys = db.prepare(
  `SELECT verdict, conviction, max_gain_pct, max_drawdown_pct FROM signals
    WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL AND max_drawdown_pct IS NOT NULL`,
).all() as Row[];
db.close();

const L = (rungs: [number, number][]) => rungs.map(([multiple, sellPct]) => ({ multiple, sellPct }));
const MODELS: { name: string; m: ExitModel }[] = [
  { name: "M0 current  [2/3/5] stop45 act1.5", m: { ladder: L([[2, 0.4], [3, 0.3], [5, 0.2]]), trailingStopPct: 0.35, stopLossPct: 0.45, trailingActivateMultiple: 1.5 } },
  { name: "M1 current  no-stop              ", m: { ladder: L([[2, 0.4], [3, 0.3], [5, 0.2]]), trailingStopPct: 0.35, stopLossPct: 0, trailingActivateMultiple: 1.5 } },
  { name: "M2 current  stop65              ", m: { ladder: L([[2, 0.4], [3, 0.3], [5, 0.2]]), trailingStopPct: 0.35, stopLossPct: 0.65, trailingActivateMultiple: 1.5 } },
  { name: "M3 EARLY   [1.3/1.6/2.2/4] stop45", m: { ladder: L([[1.3, 0.3], [1.6, 0.3], [2.2, 0.25], [4, 0.15]]), trailingStopPct: 0.3, stopLossPct: 0.45, trailingActivateMultiple: 1.3 } },
  { name: "M4 EARLY   same stop35          ", m: { ladder: L([[1.3, 0.3], [1.6, 0.3], [2.2, 0.25], [4, 0.15]]), trailingStopPct: 0.3, stopLossPct: 0.35, trailingActivateMultiple: 1.3 } },
  { name: "M5 EARLY   same no-stop         ", m: { ladder: L([[1.3, 0.3], [1.6, 0.3], [2.2, 0.25], [4, 0.15]]), trailingStopPct: 0.3, stopLossPct: 0, trailingActivateMultiple: 1.3 } },
  { name: "M6 AGGR    [1.25/1.5/2] stop40   ", m: { ladder: L([[1.25, 0.4], [1.5, 0.3], [2, 0.2]]), trailingStopPct: 0.25, stopLossPct: 0.4, trailingActivateMultiple: 1.25 } },
  { name: "M7 AGGR    same stop30           ", m: { ladder: L([[1.25, 0.4], [1.5, 0.3], [2, 0.2]]), trailingStopPct: 0.25, stopLossPct: 0.3, trailingActivateMultiple: 1.25 } },
  { name: "SHIP [1.4/1.8/2.5/5] stop40 trl30 a1.25", m: { ladder: L([[1.4, 0.3], [1.8, 0.3], [2.5, 0.2], [5, 0.1]]), trailingStopPct: 0.3, stopLossPct: 0.4, trailingActivateMultiple: 1.25 } },
];
const FILTERS: { name: string; f: (r: Row) => boolean }[] = [
  { name: "all BUYs        ", f: () => true },
  { name: "conv<72 (no STR)", f: (r) => (r.conviction ?? 0) < 72 },
  { name: "conv 60-71      ", f: (r) => (r.conviction ?? 0) >= 60 && (r.conviction ?? 0) < 72 },
  { name: "conv>=60        ", f: (r) => (r.conviction ?? 0) >= 60 },
];

function evalPolicy(rows: Row[], m: ExitModel) {
  let opt = 0, pess = 0, n = 0, wins = 0;
  for (const r of rows) {
    const b = exitOutcomeBounds(r.max_gain_pct ?? 0, r.max_drawdown_pct ?? 0, m);
    opt += b.optimistic - 1; pess += b.pessimistic - 1; n++;
    if (b.optimistic > 1) wins++;
  }
  return { n, opt: n ? opt / n : 0, pess: n ? pess / n : 0, mid: n ? (opt + pess) / (2 * n) : 0, win: n ? wins / n : 0 };
}

console.log(`universe: ${buys.length} resolved BUYs\n`);
console.log("PnL = mean per-trade fraction (0 = breakeven). opt=peak-first  pess=trough-first  mid=avg\n");
for (const flt of FILTERS) {
  const rows = buys.filter(flt.f);
  console.log(`── entry: ${flt.name}  (n=${rows.length}) ──────────────────────────────`);
  console.log(`   ${"model".padEnd(34)} ${"opt".padStart(7)} ${"pess".padStart(7)} ${"mid".padStart(7)} ${"win%".padStart(6)}`);
  const scored = MODELS.map((mod) => ({ name: mod.name, ...evalPolicy(rows, mod.m) }));
  for (const s of scored) {
    console.log(`   ${s.name.padEnd(34)} ${(s.opt * 100).toFixed(1).padStart(7)} ${(s.pess * 100).toFixed(1).padStart(7)} ${(s.mid * 100).toFixed(1).padStart(7)} ${(s.win * 100).toFixed(1).padStart(6)}`);
  }
  const best = [...scored].sort((a, b) => b.mid - a.mid)[0];
  console.log(`   => best by mid: ${best.name.trim()}  mid=${(best.mid * 100).toFixed(1)}%\n`);
}
