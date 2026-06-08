import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type R = { verdict: string; conviction: number; price_at_alert: number; price_5m: number | null; price_15m: number | null; price_1h: number | null; max_gain_pct: number | null; max_drawdown_pct: number | null; };
const rows = db.prepare(`
  SELECT verdict, conviction, price_at_alert, price_5m, price_15m, price_1h, max_gain_pct, max_drawdown_pct
  FROM signals
  WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert>0 AND max_gain_pct IS NOT NULL`).all() as R[];
const ret = (p: number | null, e: number) => (p != null ? (p - e) / e : null);

console.log(`N traded BUYs (stable, resolved): ${rows.length}`);

// ── (1) BUY_SMALL vs BUY_STRONG outcome differentiation ──
console.log("\n=== Outcome by verdict tier (does conviction predict outcome?) ===");
for (const v of ["BUY_SMALL", "BUY_STRONG"]) {
  const g = rows.filter((r) => r.verdict === v);
  const peaks = g.map((r) => r.max_gain_pct ?? 0);
  const h2 = g.filter((r) => (r.max_gain_pct ?? 0) >= 100).length;
  const h5 = g.filter((r) => (r.max_gain_pct ?? 0) >= 400).length;
  const avgPeak = peaks.reduce((a, x) => a + x, 0) / (g.length || 1);
  const medPeak = [...peaks].sort((a, b) => a - b)[Math.floor(peaks.length / 2)] ?? 0;
  console.log(`${v}: n=${g.length}  avgPeak=${avgPeak.toFixed(1)}%  medPeak=${medPeak.toFixed(1)}%  >=2x: ${h2} (${((h2/g.length)*100).toFixed(1)}%)  >=5x: ${h5} (${((h5/g.length)*100).toFixed(1)}%)`);
}

// ── (2) Winner early behavior: did >=2x winners dip deeply early? (tighter-stop risk) ──
const winners = rows.filter((r) => (r.max_gain_pct ?? 0) >= 100);
console.log(`\n=== Winners (peak>=2x): ${winners.length}. Their early (5m/15m) returns ===`);
for (const thr of [-0.25, -0.30, -0.35, -0.40, -0.45]) {
  const dippedEarly = winners.filter((r) => {
    const r5 = ret(r.price_5m, r.price_at_alert);
    const r15 = ret(r.price_15m, r.price_at_alert);
    const trough = Math.min(r5 ?? 0, r15 ?? 0);
    return trough <= thr;
  }).length;
  console.log(`  winners whose min(ret5m,ret15m) <= ${(thr*100).toFixed(0)}%: ${dippedEarly} (${((dippedEarly/winners.length)*100).toFixed(1)}% of winners would be cut by a stop here)`);
}

// ── (3) STOP SWEEP: trade-off of stop threshold using min(ret5m,ret15m) trough proxy ──
console.log("\n=== STOP-LOSS SWEEP (trough proxy = min(ret5m,ret15m)) ===");
console.log("threshold | winnersCut | losersCaught | nonWinnersCaught%");
const nonWinners = rows.filter((r) => (r.max_gain_pct ?? 0) < 100);
for (const thr of [-0.25, -0.30, -0.35, -0.40, -0.45, -0.50]) {
  const wCut = winners.filter((r) => Math.min(ret(r.price_5m, r.price_at_alert) ?? 0, ret(r.price_15m, r.price_at_alert) ?? 0) <= thr).length;
  const lCaught = nonWinners.filter((r) => Math.min(ret(r.price_5m, r.price_at_alert) ?? 0, ret(r.price_15m, r.price_at_alert) ?? 0) <= thr).length;
  console.log(`  ${(thr*100).toFixed(0)}%   | ${wCut}/${winners.length} (${((wCut/winners.length)*100).toFixed(1)}%) | ${lCaught}/${nonWinners.length} (${((lCaught/nonWinners.length)*100).toFixed(1)}%)`);
}

// ── (4) TIME-STOP timing: where is the coin at 1h vs peak? Is 4h hold justified? ──
console.log("\n=== TIME-STOP: state at 1h horizon (n with price_1h) ===");
const with1h = rows.filter((r) => r.price_1h != null);
let alive1h = 0, dead1h = 0;
for (const r of with1h) {
  const r1 = ret(r.price_1h, r.price_at_alert)!;
  if (r1 > 0) alive1h++; else dead1h++;
}
console.log(`  traded with price_1h: ${with1h.length}  green@1h: ${alive1h} (${((alive1h/with1h.length)*100).toFixed(1)}%)  red@1h: ${dead1h} (${((dead1h/with1h.length)*100).toFixed(1)}%)`);
// of winners, how many already >=2x by 1h (i.e. peak likely captured well before 4h)?
const wWith1h = winners.filter((r) => r.price_1h != null);
const won_by1h = wWith1h.filter((r) => ret(r.price_1h, r.price_at_alert)! >= 1.0).length;
console.log(`  winners with price_1h: ${wWith1h.length}; still >=2x at 1h: ${won_by1h} (${((won_by1h/(wWith1h.length||1))*100).toFixed(1)}%)`);
// mean drawdown-from-peak across all — how much give-back is normal?
const dd = rows.map((r) => r.max_drawdown_pct ?? 0);
const avgDD = dd.reduce((a, x) => a + x, 0) / (dd.length || 1);
const medDD = [...dd].sort((a, b) => a - b)[Math.floor(dd.length / 2)] ?? 0;
console.log(`\n=== max_drawdown_pct (give-back from peak) over all traded: avg=${avgDD.toFixed(1)}% median=${medDD.toFixed(1)}% ===`);
// among winners specifically (relevant to trailing-stop calibration)
const wdd = winners.map((r) => r.max_drawdown_pct ?? 0);
console.log(`  winners' max_drawdown_pct: avg=${(wdd.reduce((a,x)=>a+x,0)/(wdd.length||1)).toFixed(1)}% median=${([...wdd].sort((a,b)=>a-b)[Math.floor(wdd.length/2)]??0).toFixed(1)}%`);

db.close();
