import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// Pull traded BUYs: signals that became paper positions OR all BUY verdicts with price points.
// The finding says "887 traded BUYs". Let's reconstruct from signals with price_at_alert + price_5m/15m.
type Row = {
  mint: string; symbol: string; verdict: string; conviction: number;
  price_at_alert: number | null; price_5m: number | null; price_15m: number | null;
  price_1h: number | null; max_gain_pct: number | null; max_drawdown_pct: number | null;
};

const rows = db.prepare(`
  SELECT mint, symbol, verdict, conviction, price_at_alert, price_5m, price_15m, price_1h, max_gain_pct, max_drawdown_pct
  FROM signals
  WHERE verdict LIKE 'BUY%'
`).all() as Row[];

console.log("total BUY signals:", rows.length);

// ret at a horizon vs price_at_alert
const ret = (p: number | null, base: number | null) =>
  (p != null && base != null && base > 0) ? (p / base - 1) : null;

// keep rows with a usable base and at least one of 5m/15m
const usable = rows.filter(r => r.price_at_alert != null && r.price_at_alert > 0 &&
  (r.price_5m != null || r.price_15m != null));
console.log("usable (base + >=1 of 5m/15m):", usable.length);

// trough proxy = min(ret5m, ret15m); final outcome proxy = best available later point
function trough(r: Row): number {
  const a = ret(r.price_5m, r.price_at_alert);
  const b = ret(r.price_15m, r.price_at_alert);
  const vals = [a, b].filter((x): x is number => x != null);
  return Math.min(...vals);
}
// "winner" definition candidates: use max_gain_pct >= 100 (2x) as the finding implies 72 winners
function isWinner2x(r: Row): boolean {
  return r.max_gain_pct != null && r.max_gain_pct >= 100;
}
// final return proxy for PnL: prefer 1h, else 15m, else 5m, vs base
function finalRet(r: Row): number | null {
  const f1 = ret(r.price_1h, r.price_at_alert);
  if (f1 != null) return f1;
  const f15 = ret(r.price_15m, r.price_at_alert);
  if (f15 != null) return f15;
  return ret(r.price_5m, r.price_at_alert);
}

const winners = usable.filter(isWinner2x);
const losers = usable.filter(r => !isWinner2x(r));
console.log("winners(2x):", winners.length, "losers:", losers.length);

// Sweep
for (const stop of [0.30, 0.35, 0.40, 0.45, 0.50]) {
  const thr = -stop;
  const winCut = winners.filter(r => trough(r) <= thr).length;
  const loseCatch = losers.filter(r => trough(r) <= thr).length;
  console.log(`stop=${stop.toFixed(2)} thr=${thr} | winnersCut=${winCut}/${winners.length} (${(100*winCut/winners.length).toFixed(1)}%) | losersCaught=${loseCatch}/${losers.length} (${(100*loseCatch/losers.length).toFixed(1)}%)`);
}

// CRITICAL adversarial test: the +57 band — coins whose trough is in (-45%, -35%].
// These are caught by -35% but NOT by -45%. Do they recover? What's their final return?
const band = usable.filter(r => {
  const t = trough(r);
  return t <= -0.35 && t > -0.45;
});
console.log("\n--- BAND (-45% < trough <= -35%): caught by 0.35 but not 0.45 ---");
console.log("band size:", band.length);
const bandFinals = band.map(finalRet).filter((x): x is number => x != null);
const recoverBreakeven = band.filter(r => { const f = finalRet(r); return f != null && f >= 0; }).length;
const recoverPos20 = band.filter(r => { const f = finalRet(r); return f != null && f >= 0.20; }).length;
const recover2x = band.filter(r => isWinner2x(r)).length;
const medianFinal = (() => {
  const s = [...bandFinals].sort((a,b)=>a-b);
  return s.length ? s[Math.floor(s.length/2)] : NaN;
})();
console.log("band recover to >=0% (breakeven+):", recoverBreakeven, `/${band.length}`);
console.log("band recover to >=+20%:", recoverPos20, `/${band.length}`);
console.log("band reach 2x (max_gain):", recover2x, `/${band.length}`);
console.log("band median finalRet:", (medianFinal*100).toFixed(1)+"%");
console.log("band mean finalRet:", (100*bandFinals.reduce((a,b)=>a+b,0)/bandFinals.length).toFixed(1)+"%");

// PnL comparison: simulate per-trade realized return with stop at 0.45 vs 0.35.
// Model: if trough <= -stop, realized = -stop (we exit at the stop). Else realized = finalRet (or capped by ladder, ignore ladder here for stop-isolation).
function simMeanReturn(stop: number): { mean: number; n: number } {
  const thr = -stop;
  let sum = 0, n = 0;
  for (const r of usable) {
    const f = finalRet(r);
    if (f == null) continue;
    const t = trough(r);
    const realized = (t <= thr) ? -stop : f;
    sum += realized; n++;
  }
  return { mean: sum / n, n };
}
console.log("\n--- naive per-trade mean realized return (stop isolation, no ladder/trailing) ---");
for (const stop of [0.30, 0.35, 0.40, 0.45, 0.50]) {
  const { mean, n } = simMeanReturn(stop);
  console.log(`stop=${stop.toFixed(2)} meanRealized=${(mean*100).toFixed(2)}% n=${n}`);
}

// Also: what fraction of the deep-dip (<=-45% at trough) ever reach 2x / 1.5x?
const deep = usable.filter(r => trough(r) <= -0.45);
const deep2x = deep.filter(isWinner2x).length;
const deep15 = deep.filter(r => r.max_gain_pct != null && r.max_gain_pct >= 50).length;
console.log("\n--- deep dip trough<=-45% ---");
console.log("deep count:", deep.length, "reach2x:", deep2x, "reach1.5x:", deep15);

db.close();
