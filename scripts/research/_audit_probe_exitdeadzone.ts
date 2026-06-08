import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// ── Claim 1: signals table — traded BUYs and how many peaked >=2x ──
// "peaked >=2x" => max_gain_pct >= 100
const buyVerdicts = db.prepare(`SELECT DISTINCT verdict FROM signals`).all();
console.log("distinct verdicts:", JSON.stringify(buyVerdicts));

const totalSignals = (db.prepare(`SELECT COUNT(*) n FROM signals`).get() as any).n;
console.log("total signals:", totalSignals);

// BUYs: verdict like BUY%
const buys = db.prepare(`SELECT COUNT(*) n FROM signals WHERE verdict LIKE 'BUY%'`).get() as any;
console.log("BUY signals:", buys.n);

// of BUYs with a non-null max_gain_pct (i.e. tracked/"traded")
const buysTracked = db.prepare(`SELECT COUNT(*) n FROM signals WHERE verdict LIKE 'BUY%' AND max_gain_pct IS NOT NULL`).get() as any;
console.log("BUY signals with max_gain_pct NOT NULL:", buysTracked.n);

const buyPeaked2x = db.prepare(`SELECT COUNT(*) n FROM signals WHERE verdict LIKE 'BUY%' AND max_gain_pct >= 100`).get() as any;
console.log("BUY signals peaked >=2x (max_gain_pct>=100):", buyPeaked2x.n);

const buyPeaked2xPct = (buyPeaked2x.n / buysTracked.n * 100).toFixed(1);
console.log(`=> ${buyPeaked2x.n}/${buysTracked.n} = ${buyPeaked2xPct}% of tracked BUYs peaked >=2x`);

// distribution of max_gain_pct among tracked BUYs
console.log("\n=== max_gain_pct buckets (tracked BUYs) ===");
const rows = db.prepare(`SELECT max_gain_pct FROM signals WHERE verdict LIKE 'BUY%' AND max_gain_pct IS NOT NULL`).all() as any[];
const b = { "<0% (never green)": 0, "0-50%": 0, "50-100% (peak1.5-2x)": 0, "100-200% (2-3x)": 0, "200-400% (3-5x)": 0, ">=400% (>=5x)": 0 };
for (const r of rows) {
  const g = r.max_gain_pct;
  if (g < 0) b["<0% (never green)"]++;
  else if (g < 50) b["0-50%"]++;
  else if (g < 100) b["50-100% (peak1.5-2x)"]++;
  else if (g < 200) b["100-200% (2-3x)"]++;
  else if (g < 400) b["200-400% (3-5x)"]++;
  else b[">=400% (>=5x)"]++;
}
console.table(b);

// ── Claim 2: paper_positions peak-multiple buckets ──
console.log("\n=== paper_positions peak multiple buckets ===");
const positions = db.prepare(`SELECT entry_price_usd, peak_price_usd, status FROM paper_positions`).all() as any[];
console.log("total paper_positions:", positions.length);
const pb = { "<1x": 0, "1-1.5x": 0, "1.5-2x": 0, "2-3x": 0, "3-5x": 0, ">=5x": 0, "bad_entry": 0 };
for (const p of positions) {
  if (!(p.entry_price_usd > 0)) { pb["bad_entry"]++; continue; }
  const m = p.peak_price_usd / p.entry_price_usd;
  if (m < 1) pb["<1x"]++;
  else if (m < 1.5) pb["1-1.5x"]++;
  else if (m < 2) pb["1.5-2x"]++;
  else if (m < 3) pb["2-3x"]++;
  else if (m < 5) pb["3-5x"]++;
  else pb[">=5x"]++;
}
console.table(pb);
const below2 = pb["<1x"] + pb["1-1.5x"] + pb["1.5-2x"];
console.log(`positions peaked below 2x: ${below2}/${positions.length} = ${(below2/positions.length*100).toFixed(1)}%`);

// How many positions peaked >=2.31x (trailing-stop can ever fire)?
let canTrail = 0;
for (const p of positions) {
  if (!(p.entry_price_usd > 0)) continue;
  const m = p.peak_price_usd / p.entry_price_usd;
  if (m >= 2.31) canTrail++;
}
console.log(`positions that ever could trigger trailing stop (peak>=2.31x): ${canTrail}/${positions.length} = ${(canTrail/positions.length*100).toFixed(1)}%`);

// ── Claim 3: winners' median max_drawdown_pct ──
console.log("\n=== winners' max_drawdown_pct (signals, BUY, peaked >=2x) ===");
const dd = db.prepare(`SELECT max_drawdown_pct FROM signals WHERE verdict LIKE 'BUY%' AND max_gain_pct >= 100 AND max_drawdown_pct IS NOT NULL ORDER BY max_drawdown_pct`).all() as any[];
if (dd.length > 0) {
  const vals = dd.map(x => x.max_drawdown_pct);
  const median = vals[Math.floor(vals.length / 2)];
  const mean = vals.reduce((a, c) => a + c, 0) / vals.length;
  console.log(`n=${vals.length}, median max_drawdown_pct=${median}, mean=${mean.toFixed(1)}, min=${vals[0]}, max=${vals[vals.length-1]}`);
}

// ── Sub-2x peakers: what exit reason did they take, and what PnL? ──
// Use signals: exit_reason + hypothetical_pnl_sol for BUYs that peaked < 2x but >= 1.4x
console.log("\n=== BUYs that peaked 1.4x-2.0x (40-100% gain): exit reasons + outcomes ===");
const band = db.prepare(`SELECT exit_reason, hypothetical_pnl_sol, max_gain_pct, max_drawdown_pct, price_at_alert, price_5m, price_15m, price_1h FROM signals WHERE verdict LIKE 'BUY%' AND max_gain_pct >= 40 AND max_gain_pct < 100`).all() as any[];
console.log("count in 1.4x-2.0x band:", band.length);
const exitAgg: Record<string, {n:number; sum:number; wins:number}> = {};
for (const r of band) {
  const er = r.exit_reason || "NULL";
  exitAgg[er] ??= {n:0,sum:0,wins:0};
  exitAgg[er].n++;
  exitAgg[er].sum += r.hypothetical_pnl_sol ?? 0;
  if ((r.hypothetical_pnl_sol ?? 0) > 0) exitAgg[er].wins++;
}
console.table(Object.entries(exitAgg).map(([k,v]) => ({exit_reason:k, n:v.n, sum_pnl:+v.sum.toFixed(4), avg_pnl:+(v.sum/v.n).toFixed(5), winrate:+(v.wins/v.n*100).toFixed(1)})));

// What fraction of the 1.4-2.0x band ended with hypothetical_pnl_sol <= 0?
const bandLosers = band.filter(r => (r.hypothetical_pnl_sol ?? 0) <= 0).length;
console.log(`1.4-2.0x band ending <=0 PnL: ${bandLosers}/${band.length} = ${band.length>0?(bandLosers/band.length*100).toFixed(1):'NA'}%`);

db.close();
