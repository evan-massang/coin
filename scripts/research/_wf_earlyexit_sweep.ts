import Database from 'better-sqlite3';

const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });

// ---- 0. sanity: schema + counts ----
const cols = db.prepare(`PRAGMA table_info(signals)`).all() as any[];
const colNames = new Set(cols.map(c => c.name));
const need = ['verdict','conviction','price_at_alert','price_5m','price_15m','price_1h','max_gain_pct','max_drawdown_pct','real_pnl_sol','symbol','at'];
console.log('=== schema check ===');
for (const n of need) if (!colNames.has(n)) console.log('  MISSING COLUMN:', n);
console.log('  all needed columns present:', need.every(n => colNames.has(n)));

type Row = {
  verdict: string;
  conviction: number | null;
  price_at_alert: number | null;
  price_5m: number | null;
  price_15m: number | null;
  price_1h: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
  real_pnl_sol: number | null;
  symbol: string | null;
  at: number | null;
};

// TRADED = BUY_SMALL / BUY_STRONG
const traded = db.prepare(
  `SELECT verdict, conviction, price_at_alert, price_5m, price_15m, price_1h,
          max_gain_pct, max_drawdown_pct, real_pnl_sol, symbol, at
   FROM signals
   WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`
).all() as Row[];

console.log('\n=== population ===');
console.log('total traded BUYs:', traded.length);

const hasEntry = (r: Row) => r.price_at_alert != null && r.price_at_alert > 0;
const ret = (r: Row, p: number | null): number | null =>
  (hasEntry(r) && p != null) ? (p - (r.price_at_alert as number)) / (r.price_at_alert as number) : null;

const with5 = traded.filter(r => ret(r, r.price_5m) != null);
const with15 = traded.filter(r => ret(r, r.price_15m) != null);
const with1h = traded.filter(r => ret(r, r.price_1h) != null);
console.log('have price_5m  (and valid entry):', with5.length);
console.log('have price_15m (and valid entry):', with15.length);
console.log('have price_1h  (and valid entry):', with1h.length);

// WINNER definition
const isWinner = (r: Row) =>
  (r.max_gain_pct != null && r.max_gain_pct >= 100) ||
  (r.real_pnl_sol != null && r.real_pnl_sol > 0);

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (x: number) => (x * 100).toFixed(1) + '%';

// ---- 1. verify scouting finding ----
console.log('\n=== VERIFY SCOUTING FINDING ===');
function horizonStats(rows: Row[], pick: (r: Row) => number | null, label: string) {
  const rets = rows.map(r => pick(r)).filter((x): x is number => x != null);
  const upFrac = rets.filter(x => x > 0).length / rets.length;
  console.log(`@${label}: n=${rets.length} mean=${pct(mean(rets))} median=${pct(median(rets))} up=${(upFrac*100).toFixed(0)}%`);
}
horizonStats(traded, r => ret(r, r.price_5m), '5m');
horizonStats(traded, r => ret(r, r.price_15m), '15m');
horizonStats(traded, r => ret(r, r.price_1h), '1h');

// red/green @15m peak-gain & >=2x
const w15valid = with15;
const red15 = w15valid.filter(r => (ret(r, r.price_15m) as number) <= 0);
const green15 = w15valid.filter(r => (ret(r, r.price_15m) as number) > 0);
const peak = (r: Row) => r.max_gain_pct ?? 0;
console.log(`red@15m  n=${red15.length} meanPeakGain=${mean(red15.map(peak)).toFixed(1)}% reached>=2x=${red15.filter(r => peak(r) >= 100).length} winners=${red15.filter(isWinner).length}`);
console.log(`green@15m n=${green15.length} meanPeakGain=${mean(green15.map(peak)).toFixed(1)}% reached>=2x=${green15.filter(r => peak(r) >= 100).length} winners=${green15.filter(isWinner).length}`);

const totalWinners = traded.filter(isWinner).length;
console.log(`\ntotal winners among ALL ${traded.length} traded BUYs:`, totalWinners);
console.log('winners that have price_5m :', with5.filter(isWinner).length);
console.log('winners that have price_15m:', with15.filter(isWinner).length);

// ---- 2. THE SWEEP ----
console.log('\n=== SWEEP: cut if return@H <= threshold ===');
const horizons: { label: string; pick: (r: Row) => number | null; rows: Row[] }[] = [
  { label: '5m', pick: r => ret(r, r.price_5m), rows: with5 },
  { label: '15m', pick: r => ret(r, r.price_15m), rows: with15 },
];
const thresholds = [0, -0.10, -0.20, -0.30];

console.log('\nhorizon | thresh | #cut | winnersCut(FP) | losersCut | meanRet@H(exit price) | medianRet@H | winnerCutRate | %ofWinnersInPop cut');
console.log('-'.repeat(120));

type Result = {
  horizon: string; thresh: number; nCut: number; winnersCut: number; losersCut: number;
  meanRetCut: number; medianRetCut: number; popWinners: number; popN: number;
};
const results: Result[] = [];

for (const h of horizons) {
  const popWinners = h.rows.filter(isWinner).length; // winners that HAVE this horizon sample
  for (const t of thresholds) {
    const cut = h.rows.filter(r => (h.pick(r) as number) <= t);
    const cutRets = cut.map(r => h.pick(r) as number);
    const winnersCut = cut.filter(isWinner).length;
    const res: Result = {
      horizon: h.label, thresh: t, nCut: cut.length, winnersCut,
      losersCut: cut.length - winnersCut,
      meanRetCut: mean(cutRets), medianRetCut: median(cutRets),
      popWinners, popN: h.rows.length,
    };
    results.push(res);
    const winnerCutRate = cut.length ? (winnersCut / cut.length * 100).toFixed(1) + '%' : 'n/a';
    const fracPopWinnersCut = popWinners ? (winnersCut / popWinners * 100).toFixed(0) + '%' : 'n/a';
    console.log(
      `${h.label.padEnd(7)} | ${(t*100).toFixed(0).padStart(5)}% | ${String(cut.length).padStart(4)} | ${String(winnersCut).padStart(13)} | ${String(cut.length-winnersCut).padStart(9)} | ${pct(res.meanRetCut).padStart(20)} | ${pct(res.medianRetCut).padStart(11)} | ${winnerCutRate.padStart(13)} | ${fracPopWinnersCut.padStart(6)}`
    );
  }
}

// ---- 3. pick best + stability ----
console.log('\n=== SELECTION: cut most losers at least-bad price, lose ~0 winners ===');
// Rank: prefer 0 winnersCut, then maximize losersCut, then least-bad (highest) meanRetCut.
const ranked = [...results].sort((a, b) => {
  if (a.winnersCut !== b.winnersCut) return a.winnersCut - b.winnersCut; // fewer FP first
  if (a.losersCut !== b.losersCut) return b.losersCut - a.losersCut;     // more losers cut
  return b.meanRetCut - a.meanRetCut;                                    // least-bad exit
});
console.log('top candidates (winnersCut asc, losersCut desc, meanRet desc):');
for (const r of ranked.slice(0, 6)) {
  console.log(`  ${r.horizon} <=${(r.thresh*100).toFixed(0)}%  cut=${r.nCut} losersCut=${r.losersCut} winnersCut=${r.winnersCut} exit≈${pct(r.meanRetCut)}`);
}

// stability: for the chosen horizon, look at how winnersCut & losersCut move across thresholds
console.log('\n=== STABILITY (per horizon, across thresholds) ===');
for (const h of horizons) {
  const rs = results.filter(r => r.horizon === h.label).sort((a, b) => b.thresh - a.thresh);
  console.log(`\n${h.label} (pop n=${rs[0].popN}, pop winners=${rs[0].popWinners}):`);
  for (const r of rs) {
    console.log(`  thr ${(r.thresh*100).toFixed(0).padStart(4)}%: cut=${String(r.nCut).padStart(3)} losers=${String(r.losersCut).padStart(3)} winnersCut=${r.winnersCut} exit≈${pct(r.meanRetCut)}`);
  }
}

db.close();
