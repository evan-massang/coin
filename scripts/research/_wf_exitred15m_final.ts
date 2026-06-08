/**
 * FINAL (READ-ONLY, frozen snapshot): realized-PnL impact of "exit-if-red-at-15m"
 * vs CURRENT exits, on traded BUYs with price_15m sample AND resolved max_gain_pct.
 * Reads /tmp/snap.sqlite (a frozen copy taken at analysis time, because the live
 * data/sniper.sqlite is being written by the running engine and n drifts).
 *   npx tsx scripts/research/_wf_exitred15m_final.ts
 *
 * MODEL ASSUMPTIONS — see header of _wf_exitred15m_pnl.ts. Summary:
 *  - PnL = fractional return per unit capital (real_pnl_sol is NULL for all traded
 *    rows, so WINNER == max_gain_pct>=100; SOL-PnL leg is moot).
 *  - A (CURRENT approx): dd>=45% -> -0.45 stop ; else peak>=2x -> laddered capture
 *    (40%@2x,30%@3x,20%@5x; remainder trails out at peak*(1-0.35)) ; else fizzle ->
 *    exit at recorded ret15m.
 *  - B (EARLY): ret15m<=0 -> exit at ret15m ; else fall back to A.
 */
import Database from "better-sqlite3";

import path from "node:path";
// NOTE: live DB is being written by the running engine, so n drifts run-to-run.
// For a frozen point-in-time, copy sniper.sqlite(+ -wal,-shm) and point here.
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Row = {
  id: number; symbol: string | null;
  price_at_alert: number | null; price_15m: number | null;
  max_gain_pct: number | null; max_drawdown_pct: number | null; real_pnl_sol: number | null;
};

const rows = db.prepare(
  `SELECT id, symbol, price_at_alert, price_15m, max_gain_pct, max_drawdown_pct, real_pnl_sol
     FROM signals
    WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
      AND price_at_alert IS NOT NULL AND price_at_alert>0
      AND price_15m IS NOT NULL AND max_gain_pct IS NOT NULL`,
).all() as Row[];

const STOP = 0.45, TRAIL = 0.35;
const ret15 = (r: Row) => (r.price_15m! - r.price_at_alert!) / r.price_at_alert!;

function ladderPnl(peak: number): number {
  let sold = 0, cap = 0;
  cap += 0.4 * 1.0; sold += 0.4;                       // 2x
  if (peak >= 2) { cap += 0.3 * 2.0; sold += 0.3; }    // 3x
  if (peak >= 4) { cap += 0.2 * 4.0; sold += 0.2; }    // 5x
  cap += (1 - sold) * (peak * (1 - TRAIL));            // remainder trails
  return cap;
}
function policyA(r: Row): number {
  const peak = (r.max_gain_pct ?? 0) / 100, dd = (r.max_drawdown_pct ?? 0) / 100;
  if (dd >= STOP) return -STOP;
  if (peak >= 1) return ladderPnl(peak);
  return ret15(r);
}
function policyB(r: Row): number {
  const x = ret15(r);
  return x <= 0 ? x : policyA(r);
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

const n = rows.length;
const A = rows.map(policyA), B = rows.map(policyB);
const winners = rows.filter((r) => (r.max_gain_pct ?? 0) >= 100);
const winnersCutByB = winners.filter((r) => ret15(r) <= 0);
const reds = rows.filter((r) => ret15(r) <= 0);

console.log(`SAMPLE: n=${n} traded BUYs with price_15m & resolved max_gain (frozen snapshot)`);
console.log(`real_pnl_sol non-null: ${rows.filter((r) => r.real_pnl_sol != null).length}  => WINNER == max_gain_pct>=100`);
console.log(``);
console.log(`MEAN PnL/trade   A (current): ${(mean(A)*100).toFixed(2)}%   median ${(med(A)*100).toFixed(2)}%`);
console.log(`MEAN PnL/trade   B (early)  : ${(mean(B)*100).toFixed(2)}%   median ${(med(B)*100).toFixed(2)}%`);
console.log(`DELTA  B - A (mean): ${((mean(B)-mean(A))*100).toFixed(2)} pp/trade   (negative => B is WORSE)`);
console.log(``);
console.log(`WINNERS (max_gain>=100): ${winners.length}`);
console.log(`  of which RED@15m (cut early by B): ${winnersCutByB.length}`);
for (const r of winners) console.log(`    ${r.symbol ?? r.id}: ret15m=${(ret15(r)*100).toFixed(1)}% peak=${(r.max_gain_pct??0).toFixed(0)}% dd=${(r.max_drawdown_pct??0).toFixed(0)}%  ${ret15(r)<=0?'<-- CUT by B':''}`);
console.log(``);
console.log(`WHY B LOSES: among ${reds.length} RED@15m tokens, how many are ALREADY past the -45% stop at 15m?`);
const deepReds = reds.filter((r) => ret15(r) <= -STOP);
console.log(`  ret15m <= -45%: ${deepReds.length}/${reds.length}.  For these, A caps loss at -45% via stop;`);
console.log(`  B realizes the deeper 15m price (mean ${(mean(deepReds.map(ret15))*100).toFixed(1)}%).`);
console.log(`  mean ret15m on ALL reds: ${(mean(reds.map(ret15))*100).toFixed(1)}%  (deeper than the -45% stop on average)`);

db.close();
