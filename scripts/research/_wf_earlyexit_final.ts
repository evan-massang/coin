import Database from 'better-sqlite3';
const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });

type Row = {
  price_at_alert: number | null; price_5m: number | null; price_15m: number | null;
  max_gain_pct: number | null; max_drawdown_pct: number | null; real_pnl_sol: number | null; symbol: string | null;
};
const traded = db.prepare(
  `SELECT price_at_alert, price_5m, price_15m, max_gain_pct, max_drawdown_pct, real_pnl_sol, symbol
   FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`
).all() as Row[];

const ENTRY = (r: Row) => r.price_at_alert != null && r.price_at_alert > 0;
const ret = (r: Row, p: number | null) => (ENTRY(r) && p != null) ? (p - r.price_at_alert!) / r.price_at_alert! : null;
const isWinner = (r: Row) => (r.max_gain_pct != null && r.max_gain_pct >= 100) || (r.real_pnl_sol != null && r.real_pnl_sol > 0);
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const median = (xs: number[]) => { if (!xs.length) return NaN; const s=[...xs].sort((a,b)=>a-b); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; };

// stale-flat = forward sample exactly equals entry (tracker never refreshed) -> not a real "red"
const isFlatStale = (r: Row, p: number | null) => ENTRY(r) && p != null && p === r.price_at_alert;

const horizons = [
  { label: '5m', pick: (r: Row) => r.price_5m },
  { label: '15m', pick: (r: Row) => r.price_15m },
];
const thresholds = [0, -0.10, -0.20, -0.30];

console.log('=== FINAL CLEAN SWEEP (one population, flat-stale flagged) ===\n');
for (const h of horizons) {
  const pop = traded.filter(r => ret(r, h.pick(r)) != null);
  const stale = pop.filter(r => isFlatStale(r, h.pick(r)));
  const popWinners = pop.filter(isWinner).length;
  console.log(`--- horizon ${h.label}: pop n=${pop.length} (winners=${popWinners}, flat-stale=${stale.length}) ---`);
  console.log('thresh | #cut | winnersCut | losersCut | meanExit | medExit | flat-stale-in-cut | cut(excl stale) | winnersCut(excl stale)');
  for (const t of thresholds) {
    const cut = pop.filter(r => (ret(r, h.pick(r)) as number) <= t);
    const cutR = cut.map(r => ret(r, h.pick(r)) as number);
    const wc = cut.filter(isWinner).length;
    const staleInCut = cut.filter(r => isFlatStale(r, h.pick(r))).length;
    const cutNoStale = cut.filter(r => !isFlatStale(r, h.pick(r)));
    const wcNoStale = cutNoStale.filter(isWinner).length;
    console.log(
      `${(t*100).toFixed(0).padStart(5)}% | ${String(cut.length).padStart(4)} | ${String(wc).padStart(10)} | ${String(cut.length-wc).padStart(9)} | ${pct(mean(cutR)).padStart(8)} | ${pct(median(cutR)).padStart(7)} | ${String(staleInCut).padStart(17)} | ${String(cutNoStale.length).padStart(15)} | ${String(wcNoStale).padStart(21)}`
    );
  }
  console.log();
}

// Final recommendation framing: 15m <= 0 vs 15m <= -10, and 5m <= 0 fallback (earlier exit, costs 1 winner)
console.log('=== HEAD-TO-HEAD: candidate rules ===');
const p15 = traded.filter(r => ret(r, r.price_15m) != null);
const p5 = traded.filter(r => ret(r, r.price_5m) != null);
function summarize(name: string, pop: Row[], pick: (r:Row)=>number|null, t: number) {
  const cut = pop.filter(r => (ret(r, pick(r)) as number) <= t);
  const cutNoStale = cut.filter(r => !isFlatStale(r, pick(r)));
  const wc = cut.filter(isWinner).length;
  console.log(`${name}: cut=${cut.length} (real=${cutNoStale.length}) winnersCut=${wc} losersCut=${cut.length-wc} meanExit=${pct(mean(cut.map(r=>ret(r,pick(r)) as number)))} | exit on REAL cuts=${pct(mean(cutNoStale.map(r=>ret(r,pick(r)) as number)))}`);
}
summarize('15m <= 0  ', p15, r=>r.price_15m, 0);
summarize('15m <= -10', p15, r=>r.price_15m, -0.10);
summarize('5m  <= 0  ', p5,  r=>r.price_5m, 0);
summarize('5m  <= -10', p5,  r=>r.price_5m, -0.10);

console.log('\nCurrent engine baseline for the losers being cut: stop-loss -45%, time-stop 4h.');
console.log('red@15m mean max_gain =', pct(mean(p15.filter(r=>(ret(r,r.price_15m) as number)<=0).map(r=>(r.max_gain_pct??0)/100))));
db.close();
