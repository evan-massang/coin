/**
 * DIAGNOSTIC: understand why early-exit-at-15m underperforms the modeled current
 * exits. Break the 75 RED@15m tokens into buckets by max_drawdown vs 45% stop,
 * and compare what each policy assigns. READ-ONLY.
 *   npx tsx scripts/research/_wf_exitred15m_diag.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Row = {
  id: number; symbol: string | null;
  price_at_alert: number | null; price_15m: number | null;
  max_gain_pct: number | null; max_drawdown_pct: number | null;
};

const rows = db.prepare(
  `SELECT id, symbol, price_at_alert, price_15m, max_gain_pct, max_drawdown_pct
     FROM signals
    WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
      AND price_at_alert IS NOT NULL AND price_at_alert>0
      AND price_15m IS NOT NULL AND max_gain_pct IS NOT NULL`,
).all() as Row[];

const ret15 = (r: Row) => (r.price_15m! - r.price_at_alert!) / r.price_at_alert!;
const reds = rows.filter((r) => ret15(r) <= 0);

// Bucket the reds
let ddGEstop = 0, ddLTstop = 0;
let sumRet15Reds = 0;
let ret15WorseThanStop = 0; // ret15m <= -0.45 (B would be even worse than -45 cap... but B exits AT ret15m)
const STOP = 0.45;

// For reds: A assigns -0.45 if dd>=0.45 else ret15m (since peak<1 for all reds here).
// B assigns ret15m (the 15m price) regardless.
// So on reds: A-B = (dd>=.45 ? -0.45 : ret15) - ret15
//   if dd>=.45:  A-B = -0.45 - ret15.  Since ret15 in [-something,0], -0.45 - ret15.
//     e.g. ret15=-0.30 -> A=-0.45, B=-0.30 => B BETTER by 0.15. A-B=-0.15 (A worse).
//     e.g. ret15=-0.60 -> A=-0.45, B=-0.60 => B WORSE. A-B=+0.15.
let bBetter = 0, bWorse = 0, equal = 0, deltaSum = 0;
const samples: string[] = [];
for (const r of reds) {
  const dd = (r.max_drawdown_pct ?? 0) / 100;
  const peak = (r.max_gain_pct ?? 0) / 100;
  const a = dd >= STOP ? -STOP : (peak >= 1 ? null : ret15(r));
  const av = a === null ? 0 : a; // peak>=1 impossible for reds (max_gain~0), guard anyway
  const bv = ret15(r);
  const delta = av - bv; // A - B
  deltaSum += delta;
  if (Math.abs(delta) < 1e-9) equal++;
  else if (bv > av) bBetter++; // B higher pnl
  else bWorse++;
  if (dd >= STOP) ddGEstop++; else ddLTstop++;
  sumRet15Reds += ret15(r);
  if (ret15(r) <= -STOP) ret15WorseThanStop++;
  if (samples.length < 12) samples.push(`  ${r.symbol ?? r.id}: ret15=${(ret15(r)*100).toFixed(0)}% dd=${(dd*100).toFixed(0)}% peak=${(peak*100).toFixed(0)}% | A=${(av*100).toFixed(0)}% B=${(bv*100).toFixed(0)}% A-B=${(delta*100).toFixed(0)}`);
}

console.log(`RED@15m tokens: ${reds.length}`);
console.log(`  mean ret15m on reds: ${(sumRet15Reds/reds.length*100).toFixed(1)}%`);
console.log(`  dd>=45% (stop binds in A): ${ddGEstop}   dd<45%: ${ddLTstop}`);
console.log(`  ret15m <= -45% (so B exits worse than the -45% stop): ${ret15WorseThanStop}`);
console.log(`  On reds:  B better than A: ${bBetter}   B worse: ${bWorse}   equal: ${equal}`);
console.log(`  mean(A-B) on reds: ${(deltaSum/reds.length*100).toFixed(1)} pp  (positive => A higher pnl => B worse)`);
console.log(`\n  sample reds:`);
console.log(samples.join("\n"));

// Distribution of ret15m on reds (how deep are they at 15m vs the -45% stop?)
const buckets: Record<string, number> = {};
for (const r of reds) {
  const x = ret15(r) * 100;
  const k = x <= -60 ? "<= -60%" : x <= -45 ? "(-60,-45]" : x <= -30 ? "(-45,-30]" : x <= -15 ? "(-30,-15]" : "(-15,0]";
  buckets[k] = (buckets[k] ?? 0) + 1;
}
console.log(`\n  ret15m distribution on reds:`);
for (const k of ["<= -60%","(-60,-45]","(-45,-30]","(-30,-15]","(-15,0]"]) console.log(`    ${k}\t${buckets[k] ?? 0}`);

db.close();
