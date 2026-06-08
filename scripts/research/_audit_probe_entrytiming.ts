/** READ-ONLY probe: verify the "catastrophic entry timing" finding. */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const buys = db.prepare(
  `SELECT mint, verdict, conviction, price_at_alert, price_5m, price_15m, price_1h,
          max_gain_pct, max_drawdown_pct, exit_reason
   FROM signals
   WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`
).all() as any[];

console.log("total BUY signals:", buys.length);

function pct(p0: number, p1: number) { return (p1 - p0) / p0; }

// --- Probe1: price_5m distribution ---
const r5 = buys.filter(b => b.price_at_alert > 0 && b.price_5m != null && b.price_5m > 0)
  .map(b => pct(b.price_at_alert, b.price_5m));
r5.sort((a, b) => a - b);
const mean5 = r5.reduce((s, x) => s + x, 0) / r5.length;
const med5 = r5[Math.floor(r5.length / 2)];
const red5 = r5.filter(x => x < 0).length;
const deep20 = r5.filter(x => x <= -0.20).length;
console.log(`\nprice_5m: n=${r5.length} mean=${(mean5*100).toFixed(1)}% p50=${(med5*100).toFixed(1)}%`);
console.log(`  RED(<0): ${red5}/${r5.length} (${(100*red5/r5.length).toFixed(1)}%)  <=-20%: ${deep20} (${(100*deep20/r5.length).toFixed(1)}%)`);

// --- price_15m ---
const r15 = buys.filter(b => b.price_at_alert > 0 && b.price_15m != null && b.price_15m > 0)
  .map(b => pct(b.price_at_alert, b.price_15m));
const red15 = r15.filter(x => x < 0).length;
console.log(`price_15m: n=${r15.length}  RED: ${red15}/${r15.length} (${(100*red15/r15.length).toFixed(1)}%)`);

// --- Probe2: RED@5m vs GREEN@5m reaching 2x ---
// "reached 2x" -> max_gain_pct >= 100
const resolved = buys.filter(b => b.price_at_alert > 0 && b.price_5m != null && b.price_5m > 0 && b.max_gain_pct != null);
const red5set = resolved.filter(b => pct(b.price_at_alert, b.price_5m) < 0);
const grn5set = resolved.filter(b => pct(b.price_at_alert, b.price_5m) >= 0);
const red2x = red5set.filter(b => b.max_gain_pct >= 100).length;
const red15x = red5set.filter(b => b.max_gain_pct >= 50).length;
const grn2x = grn5set.filter(b => b.max_gain_pct >= 100).length;
console.log(`\nresolved (have 5m + max_gain): ${resolved.length}`);
console.log(`RED@5m: ${red5set.length} -> >=2x: ${red2x} (${(100*red2x/red5set.length).toFixed(1)}%)  >=1.5x: ${red15x} (${(100*red15x/red5set.length).toFixed(1)}%)`);
console.log(`GREEN@5m: ${grn5set.length} -> >=2x: ${grn2x} (${(100*grn2x/grn5set.length).toFixed(1)}%)`);
console.log(`gap ratio (green2x% / red2x%): ${((grn2x/grn5set.length)/(red2x/red5set.length)).toFixed(1)}x`);

// --- DEEP RED ---
const deep = resolved.filter(b => pct(b.price_at_alert, b.price_5m) <= -0.50);
const deep2x = deep.filter(b => b.max_gain_pct >= 100).length;
const deepMeanMax = deep.reduce((s, b) => s + b.max_gain_pct, 0) / deep.length;
console.log(`\nDEEP RED (<=-50%@5m): ${deep.length} -> >=2x: ${deep2x} (${(100*deep2x/deep.length).toFixed(1)}%)  meanMaxGain=${deepMeanMax.toFixed(0)}%`);

// --- CRITICAL CRITIQUE CHECK: is GREEN@5m known at decision time? No.
//     But check: does the staged-entry experiment have a survivorship/selection problem?
//     Compute: among GREEN@5m winners, what's the entry-to-5m price? (you'd buy higher) ---
const grnWinners = grn5set.filter(b => b.max_gain_pct >= 100);
const grnEntryUp = grnWinners.map(b => pct(b.price_at_alert, b.price_5m));
const meanGrnUp = grnEntryUp.reduce((s, x) => s + x, 0) / (grnEntryUp.length || 1);
console.log(`\nGREEN@5m winners: ${grnWinners.length}, mean price move alert->5m (you'd re-buy higher): ${(meanGrnUp*100).toFixed(1)}%`);

// --- What fraction of ALL eventual 2x winners were RED@5m? (the cohort staged-entry would SKIP) ---
const allWinners = resolved.filter(b => b.max_gain_pct >= 100).length;
console.log(`\nAll 2x winners (resolved): ${allWinners}; of which RED@5m: ${red2x} (${(100*red2x/allWinners).toFixed(1)}% would be filtered out by a green-only confirm)`);

// --- conviction split: does higher conviction avoid the red tail? ---
const hi = resolved.filter(b => b.conviction >= 72);
const lo = resolved.filter(b => b.conviction < 72);
const hiRed = hi.filter(b => pct(b.price_at_alert, b.price_5m) < 0).length;
const loRed = lo.filter(b => pct(b.price_at_alert, b.price_5m) < 0).length;
console.log(`\nBUY_STRONG-tier (conv>=72) n=${hi.length} red@5m=${hi.length?(100*hiRed/hi.length).toFixed(1):'-'}%; conv<72 n=${lo.length} red@5m=${lo.length?(100*loRed/lo.length).toFixed(1):'-'}%`);

db.close();
