/** READ-ONLY probe: stress-test the STAGED-ENTRY impact claim.
 * The finding says: confirm green@5m, then commit -> shift to the 21.6% cohort.
 * But you'd RE-ENTER at price_5m (higher), not price_at_alert.
 * Recompute the 2x rate and mean realizable gain FROM the price_5m re-entry. */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const buys = db.prepare(
  `SELECT price_at_alert, price_5m, max_gain_pct, max_drawdown_pct
   FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
     AND price_at_alert>0 AND price_5m>0 AND max_gain_pct IS NOT NULL`
).all() as any[];

const grn = buys.filter(b => b.price_5m >= b.price_at_alert);
// peak price multiple from alert = 1 + max_gain_pct/100
// re-entry at price_5m; ratio5 = price_5m/price_at_alert
// max gain FROM 5m re-entry = peakMult / ratio5 - 1
function gainFrom5m(b: any) {
  const peakMult = 1 + b.max_gain_pct / 100;
  const ratio5 = b.price_5m / b.price_at_alert;
  return peakMult / ratio5 - 1; // fractional
}
const g = grn.map(gainFrom5m);
const win2x_fromAlert = grn.filter(b => b.max_gain_pct >= 100).length;
const win2x_from5m = g.filter(x => x >= 1.0).length;
const win15x_from5m = g.filter(x => x >= 0.5).length;
const meanFrom5m = g.reduce((s, x) => s + x, 0) / g.length;
const medFrom5m = [...g].sort((a, b) => a - b)[Math.floor(g.length / 2)];

console.log(`GREEN@5m cohort n=${grn.length}`);
console.log(`  2x measured FROM ALERT price: ${win2x_fromAlert} (${(100*win2x_fromAlert/grn.length).toFixed(1)}%)  <-- finding's headline`);
console.log(`  2x measured FROM 5m RE-ENTRY:  ${win2x_from5m} (${(100*win2x_from5m/grn.length).toFixed(1)}%)  <-- what staged entry actually gets`);
console.log(`  1.5x from 5m re-entry: ${win15x_from5m} (${(100*win15x_from5m/grn.length).toFixed(1)}%)`);
console.log(`  mean MAX gain from 5m re-entry: ${(100*meanFrom5m).toFixed(1)}%  median: ${(100*medFrom5m).toFixed(1)}%`);
console.log(`  NOTE: mean MAX gain is an UPPER bound (assumes perfect peak exit); realized < this.`);

// How many green@5m even still ABOVE re-entry at peak?
const aboveReentry = g.filter(x => x > 0).length;
console.log(`  green@5m coins whose peak is still ABOVE the 5m re-entry: ${aboveReentry}/${grn.length} (${(100*aboveReentry/grn.length).toFixed(1)}%)`);

db.close();
