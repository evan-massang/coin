import Database from 'better-sqlite3';
const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });

type Row = {
  id: number; symbol: string; verdict: string; conviction: number;
  price_at_alert: number; price_5m: number|null; price_15m: number|null; price_1h: number|null;
  max_gain_pct: number|null; max_drawdown_pct: number|null; real_pnl_sol: number|null;
  exit_reason: string|null; hypothetical_pnl_sol: number|null; at: number;
};

const traded = db.prepare(`
  SELECT id,symbol,verdict,conviction,price_at_alert,price_5m,price_15m,price_1h,
         max_gain_pct,max_drawdown_pct,real_pnl_sol,exit_reason,hypothetical_pnl_sol,at
  FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
`).all() as Row[];

const WIN = (r: Row) => (r.max_gain_pct != null && r.max_gain_pct >= 100) || (r.real_pnl_sol != null && r.real_pnl_sol > 0);
const ret = (p: number|null, e: number) => (p!=null && e>0) ? (p-e)/e : null;

console.log(`TRADED total: ${traded.length}`);

// ---------- (0) winners in whole traded set & in p15 subset ----------
const winnersAll = traded.filter(WIN);
console.log(`\n[BASE RATE] winners in ALL traded (max_gain>=100 OR pnl>0): ${winnersAll.length}/${traded.length} = ${(100*winnersAll.length/traded.length).toFixed(1)}%`);
// breakdown of WIN cause
const winByGain = traded.filter(r => r.max_gain_pct!=null && r.max_gain_pct>=100).length;
const winByPnl  = traded.filter(r => r.real_pnl_sol!=null && r.real_pnl_sol>0).length;
console.log(`  winners via max_gain>=100: ${winByGain} ; via real_pnl_sol>0: ${winByPnl} (real_pnl non-null rows: ${traded.filter(r=>r.real_pnl_sol!=null).length})`);

const p15 = traded.filter(r => r.price_at_alert>0 && r.price_15m!=null);
const winnersP15 = p15.filter(WIN);
console.log(`\np15 subset (traded, price_at_alert>0, price_15m not null): ${p15.length}`);
console.log(`  winners inside p15 subset: ${winnersP15.length} = ${(100*winnersP15.length/p15.length).toFixed(1)}%`);

// ---------- (1) red@15m -> winners? sample size ----------
const red15 = p15.filter(r => ret(r.price_15m, r.price_at_alert)! <= 0);
const green15 = p15.filter(r => ret(r.price_15m, r.price_at_alert)! > 0);
const redWin = red15.filter(WIN);
const greenWin = green15.filter(WIN);
console.log(`\n[RED@15m] n=${red15.length}  winners=${redWin.length}`);
console.log(`[GREEN@15m] n=${green15.length}  winners=${greenWin.length}`);
console.log(`  red15 mean peak gain: ${(red15.reduce((s,r)=>s+(r.max_gain_pct||0),0)/Math.max(1,red15.length)).toFixed(1)}%`);
console.log(`  green15 mean peak gain: ${(green15.reduce((s,r)=>s+(r.max_gain_pct||0),0)/Math.max(1,green15.length)).toFixed(1)}%`);

// How many winners EXIST in the p15 set at all -> can red@15m=0 winners be luck?
// Hypergeometric tail: if winners are randomly placed, P(0 of them land in red bucket)
function logFact(n:number){let s=0;for(let i=2;i<=n;i++)s+=Math.log(i);return s;}
function logChoose(n:number,k:number){if(k<0||k>n)return -Infinity;return logFact(n)-logFact(k)-logFact(n-k);}
// P(all W winners fall in GREEN bucket of size g out of N) = C(g,W)/C(N,W)
const N = p15.length, W = winnersP15.length, g = green15.length;
const pAllInGreen = Math.exp(logChoose(g,W) - logChoose(N,W));
console.log(`\n[LUCK TEST] If ${W} winners were placed at random among ${N} p15 tokens,`);
console.log(`  P(ALL winners avoid the ${red15.length}-token RED bucket, i.e. land in ${g} green) = ${(pAllInGreen*100).toFixed(2)}%`);
console.log(`  (this is the p-value for "red@15m has 0 winners by chance"; high => not significant)`);

// ---------- (2) stop-loss overlap: would -45% SL catch the red@15m losers anyway ----------
// We don't have intramin price, but we have price_5m, price_15m, max_drawdown_pct, exit_reason.
console.log(`\n[STOP-LOSS OVERLAP]`);
const ddVals = (rows:Row[]) => rows.map(r=>r.max_drawdown_pct).filter(x=>x!=null) as number[];
// among red@15m, how many already hit <= -45% return by 5m or 15m (price sample), i.e. SL would fire at/before 15m
const slBy5m = red15.filter(r => ret(r.price_5m, r.price_at_alert)!=null && ret(r.price_5m,r.price_at_alert)! <= -0.45).length;
const slBy15m = red15.filter(r => ret(r.price_15m,r.price_at_alert)! <= -0.45).length;
console.log(`  red@15m n=${red15.length}`);
console.log(`  already <=-45% at 5m sample: ${slBy5m}  (${(100*slBy5m/Math.max(1,red15.length)).toFixed(0)}%)`);
console.log(`  already <=-45% at 15m sample: ${slBy15m}  (${(100*slBy15m/red15.length).toFixed(0)}%)`);
console.log(`  => ${red15.length-slBy15m} red@15m tokens are NOT yet at SL by 15m (rule would exit these earlier than SL/time-stop)`);
// distribution of 15m return for red bucket
const rr = red15.map(r=>ret(r.price_15m,r.price_at_alert)!).sort((a,b)=>a-b);
const q=(arr:number[],p:number)=>arr.length?arr[Math.min(arr.length-1,Math.floor(p*arr.length))]:NaN;
console.log(`  red@15m return distribution: p10=${(100*q(rr,.1)).toFixed(0)}% median=${(100*q(rr,.5)).toFixed(0)}% p90=${(100*q(rr,.9)).toFixed(0)}%`);
const between = red15.filter(r=>{const x=ret(r.price_15m,r.price_at_alert)!;return x> -0.45 && x<=0;}).length;
console.log(`  red@15m with 15m return in (-45%, 0]: ${between} (${(100*between/red15.length).toFixed(0)}%) <- the only tokens where rule beats SL on these losers`);

// exit_reason distribution to understand what the current engine actually did
console.log(`\n[EXIT REASONS] (all traded)`);
const er = db.prepare("SELECT exit_reason, COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') GROUP BY exit_reason ORDER BY n DESC").all();
console.log(er);

// ---------- (3) noise sensitivity: flip red/green near zero ----------
console.log(`\n[NOISE SENSITIVITY] reclassify with +/- band around 0`);
for (const band of [0.0, 0.05, 0.10, 0.20]) {
  // green if return > +band (give losers benefit of doubt). red bucket = return <= -band?
  // Test: does any winner sit in the "clearly red" bucket if we treat near-zero as ambiguous?
  const clearRed = p15.filter(r => ret(r.price_15m,r.price_at_alert)! <= -band);
  const winInClearRed = clearRed.filter(WIN).length;
  console.log(`  band=${(band*100).toFixed(0)}%: clearRed(ret<=-${(band*100).toFixed(0)}%) n=${clearRed.length}, winners among them=${winInClearRed}`);
}

// ---------- (4) survivorship: are p15 rows biased? compare winners base rate ----------
console.log(`\n[SURVIVORSHIP / SELECTION]`);
const noP15 = traded.filter(r => !(r.price_at_alert>0 && r.price_15m!=null));
console.log(`  traded WITH p15: n=${p15.length}, winner rate=${(100*winnersP15.length/p15.length).toFixed(1)}%, mean peak gain=${(p15.reduce((s,r)=>s+(r.max_gain_pct||0),0)/p15.length).toFixed(1)}%`);
console.log(`  traded WITHOUT p15: n=${noP15.length}, winner rate=${(100*noP15.filter(WIN).length/Math.max(1,noP15.length)).toFixed(1)}%, mean peak gain=${(noP15.reduce((s,r)=>s+(r.max_gain_pct||0),0)/Math.max(1,noP15.length)).toFixed(1)}%`);
console.log(`  (if WITHOUT-p15 rows are richer in winners, the rule was validated on a survivor-biased easy subset)`);

// Where do the missing-p15 winners' peaks come from? list winners without p15
const winNoP15 = noP15.filter(WIN);
console.log(`  winners with NO p15 sample: ${winNoP15.length} -> these are tokens the 15m rule would never even evaluate`);

// ---------- summary of ALL winners: did any go red early then recover? ----------
console.log(`\n[ALL WINNERS detail] (max_gain>=100)`);
for (const w of winnersAll.sort((a,b)=>(b.max_gain_pct||0)-(a.max_gain_pct||0))) {
  const r5 = ret(w.price_5m,w.price_at_alert), r15 = ret(w.price_15m,w.price_at_alert);
  console.log(`  ${w.symbol}\tpeak=${(w.max_gain_pct||0).toFixed(0)}%\tr5=${r5==null?'NA':(100*r5).toFixed(0)+'%'}\tr15=${r15==null?'NA':(100*r15).toFixed(0)+'%'}\texit=${w.exit_reason}`);
}
