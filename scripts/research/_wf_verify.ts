import Database from 'better-sqlite3';
const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });
type Row=any;
const traded = db.prepare(`SELECT symbol,price_at_alert,price_5m,price_15m,max_gain_pct,max_drawdown_pct FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`).all() as Row[];
const ret=(p:any,e:number)=>(p!=null&&e>0)?(p-e)/e:null;
const p15=traded.filter(r=>r.price_at_alert>0&&r.price_15m!=null);
const red15=p15.filter(r=>ret(r.price_15m,r.price_at_alert)!<=0);

// Critical: the rule exits at 15m price. For red@15m tokens already BELOW -45% at 15m,
// the current SL would have fired EARLIER (somewhere on the way down to -45%), i.e. at a BETTER price than -45%-or-worse-at-15m.
// So on the 34 tokens already past -45% by 15m, the 15m rule is strictly LATER/worse than SL.
const past45at15=red15.filter(r=>ret(r.price_15m,r.price_at_alert)!<=-0.45);
const above45at15=red15.filter(r=>{const x=ret(r.price_15m,r.price_at_alert)!;return x>-0.45&&x<=0;});
console.log(`red@15m: ${red15.length}`);
console.log(`  already <=-45% at 15m sample: ${past45at15.length}  -> SL fired EARLIER on the way down; 15m rule is LATER (no benefit, likely worse fill)`);
console.log(`  between -45% and 0 at 15m: ${above45at15.length}  -> ONLY here can 15m rule beat the SL, IF the token would have kept falling to -45%`);
const meanAbove=above45at15.reduce((s,r)=>s+ret(r.price_15m,r.price_at_alert)!,0)/Math.max(1,above45at15.length);
console.log(`  mean 15m return of the (-45%,0] bucket: ${(100*meanAbove).toFixed(1)}%  (rule exits here vs SL -45% => saves ~${(100*(meanAbove+0.45)).toFixed(0)} pts, ONLY if it would've fallen further)`);

// But many in that bucket may RECOVER (mean reversion) -> rule would lock a loss that SL/time-stop avoids.
// Proxy for recovery: max_gain_pct>0 after the alert means it traded above entry at some point.
const recovered=above45at15.filter(r=>(r.max_gain_pct||0)>10);
console.log(`  of the (-45%,0] bucket, tokens whose peak gain >10% at SOME point: ${recovered.length}/${above45at15.length} -> rule may exit these into a dip it would otherwise ride`);
