import Database from 'better-sqlite3';
const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });

type Row = {
  verdict: string; conviction: number | null; price_at_alert: number | null;
  price_5m: number | null; price_15m: number | null; price_1h: number | null;
  max_gain_pct: number | null; max_drawdown_pct: number | null;
  real_pnl_sol: number | null; symbol: string | null; at: number | null;
};
const traded = db.prepare(
  `SELECT verdict, conviction, price_at_alert, price_5m, price_15m, price_1h,
          max_gain_pct, max_drawdown_pct, real_pnl_sol, symbol, at
   FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`
).all() as Row[];

const hasEntry = (r: Row) => r.price_at_alert != null && r.price_at_alert > 0;
const ret = (r: Row, p: number | null) =>
  (hasEntry(r) && p != null) ? (p - (r.price_at_alert as number)) / (r.price_at_alert as number) : null;
const isWinner = (r: Row) =>
  (r.max_gain_pct != null && r.max_gain_pct >= 100) || (r.real_pnl_sol != null && r.real_pnl_sol > 0);
const pct = (x: number | null) => x == null ? 'null' : (x * 100).toFixed(1) + '%';

// Every winner in the traded population — does it have a 5m / 15m sample, and what was its return there?
console.log('=== ALL WINNERS (traded) — what return did they show at 5m / 15m? ===');
console.log('symbol            | maxGain% | pnlSOL | ret@5m  | ret@15m | cut@5m(<=0)? | cut@15m(<=0)?');
const winners = traded.filter(isWinner);
for (const w of winners) {
  const r5 = ret(w, w.price_5m), r15 = ret(w, w.price_15m);
  const c5 = r5 != null && r5 <= 0 ? 'CUT' : (r5 == null ? '(no5m)' : 'keep');
  const c15 = r15 != null && r15 <= 0 ? 'CUT' : (r15 == null ? '(no15m)' : 'keep');
  console.log(
    `${(w.symbol ?? '?').padEnd(17)} | ${String(w.max_gain_pct?.toFixed(0)).padStart(7)} | ${String(w.real_pnl_sol?.toFixed(3) ?? 'null').padStart(6)} | ${pct(r5).padStart(7)} | ${pct(r15).padStart(7)} | ${c5.padStart(11)} | ${c15.padStart(12)}`
  );
}

// The single 5m false-positive winner: detail
console.log('\n=== 5m FALSE POSITIVE (winner cut by 5m<=0 rule) ===');
const fp5 = traded.filter(r => { const x = ret(r, r.price_5m); return isWinner(r) && x != null && x <= 0; });
for (const w of fp5) {
  console.log(`${w.symbol}: entry=${w.price_at_alert} p5m=${w.price_5m} ret5m=${pct(ret(w,w.price_5m))} p15m=${w.price_15m} ret15m=${pct(ret(w,w.price_15m))} maxGain=${w.max_gain_pct}% pnl=${w.real_pnl_sol}`);
}

// Boundary / knife-edge probe for 15m<=0 rule: how many KEPT tokens (ret15m>0) sit just above 0,
// and how many CUT losers sit just below 0? If many cluster near 0, threshold is knife-edge.
console.log('\n=== 15m boundary clustering (how knife-edge is "<=0"?) ===');
const w15 = traded.filter(r => ret(r, r.price_15m) != null);
const bins: Record<string, number> = {};
for (const r of w15) {
  const x = ret(r, r.price_15m) as number;
  let b: string;
  if (x <= -0.5) b='<=-50%'; else if (x <= -0.3) b='-50..-30%'; else if (x <= -0.1) b='-30..-10%';
  else if (x <= 0) b='-10..0%'; else if (x <= 0.1) b='0..+10%'; else if (x <= 0.3) b='+10..+30%'; else b='>+30%';
  bins[b] = (bins[b] ?? 0) + 1;
}
const order = ['<=-50%','-50..-30%','-30..-10%','-10..0%','0..+10%','+10..+30%','>+30%'];
for (const b of order) console.log(`  ${b.padEnd(12)}: ${bins[b] ?? 0}`);

// kept (green@15m) tokens: are ANY of them near zero (fragile keeps)? show all 7
console.log('\n=== GREEN@15m kept tokens (the ones the rule preserves) ===');
const green = w15.filter(r => (ret(r, r.price_15m) as number) > 0);
console.log('symbol            | ret@15m | maxGain% | winner? | pnlSOL');
for (const g of green) {
  console.log(`${(g.symbol??'?').padEnd(17)} | ${pct(ret(g,g.price_15m)).padStart(7)} | ${String(g.max_gain_pct?.toFixed(0)).padStart(7)} | ${String(isWinner(g)).padEnd(7)} | ${g.real_pnl_sol ?? 'null'}`);
}

// Counterfactual value: what does the CURRENT engine do to the 73 red@15m losers?
// Approximate exit-without-rule using max_drawdown / stop-loss -45%. We only know peak & drawdown,
// but report mean max_gain and how many of the red@15m losers EVER reached >=2x later (rule would've missed nothing).
console.log('\n=== Counterfactual: do red@15m tokens ever recover? ===');
const red = w15.filter(r => (ret(r, r.price_15m) as number) <= 0);
const everReached2x = red.filter(r => (r.max_gain_pct ?? 0) >= 100).length;
const everGreenPeak = red.filter(r => (r.max_gain_pct ?? 0) > 0).length;
console.log(`red@15m n=${red.length}: ever reached >=2x peak = ${everReached2x}; ever had ANY positive peak = ${everGreenPeak}`);
console.log(`red@15m mean max_gain_pct = ${(red.reduce((a,b)=>a+(b.max_gain_pct??0),0)/red.length).toFixed(1)}%`);
console.log(`red@15m mean max_drawdown_pct = ${(red.reduce((a,b)=>a+(b.max_drawdown_pct??0),0)/red.length).toFixed(1)}%`);

db.close();
