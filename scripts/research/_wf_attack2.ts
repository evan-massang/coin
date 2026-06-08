import Database from 'better-sqlite3';
const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });
type Row = any;
const traded = db.prepare(`
  SELECT id,symbol,verdict,conviction,price_at_alert,price_5m,price_15m,price_1h,
         max_gain_pct,max_drawdown_pct,real_pnl_sol,exit_reason,hypothetical_pnl_sol,at
  FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`).all() as Row[];
const WIN = (r:Row)=>(r.max_gain_pct!=null&&r.max_gain_pct>=100)||(r.real_pnl_sol!=null&&r.real_pnl_sol>0);
const ret=(p:any,e:number)=>(p!=null&&e>0)?(p-e)/e:null;

// ---- KILLER QUESTION: of the 9 winners, how many would the 15m rule have EXITED before the peak? ----
// Rule: exit if RED at 15m (price_15m <= price_at_alert). Needs a price_15m sample.
console.log("=== Would the red@15m rule kill any of the 9 winners? ===");
const winners = traded.filter(WIN);
let killed=0, survivedRule=0, noSample=0;
for(const w of winners){
  const r15=ret(w.price_15m,w.price_at_alert);
  if(r15==null){ noSample++; console.log(`  ${w.symbol} peak=${w.max_gain_pct?.toFixed(0)}%: NO 15m sample -> rule blind, position held by default (NOT killed by 15m rule but also unprotected)`); }
  else if(r15<=0){ killed++; console.log(`  ${w.symbol} peak=${w.max_gain_pct?.toFixed(0)}%: r15=${(100*r15).toFixed(0)}% RED -> RULE WOULD KILL THIS WINNER`); }
  else { survivedRule++; console.log(`  ${w.symbol} peak=${w.max_gain_pct?.toFixed(0)}%: r15=${(100*r15).toFixed(0)}% green -> rule keeps it`); }
}
console.log(`\n  winners killed by rule: ${killed}, kept: ${survivedRule}, no-15m-sample(blind): ${noSample}`);

// ---- TRULL-type: winners that were deeply red EARLY (would SL or an aggressive rule have killed them?) ----
console.log("\n=== Winners that dipped red at 5m (recovery cases) ===");
for(const w of winners){
  const r5=ret(w.price_5m,w.price_at_alert);
  if(r5!=null && r5<=0) console.log(`  ${w.symbol}: r5=${(100*r5).toFixed(0)}% then peaked +${w.max_gain_pct?.toFixed(0)}% (SL at -45% would${r5<=-0.45?'':' NOT'} have fired at 5m sample)`);
}

// ---- Net value of rule on the p15 LOSERS: how much extra is saved vs current SL/time-stop? ----
// For red@15m losers NOT yet at -45%: rule exits ~ at their 15m return; SL would exit at -45% (or time-stop at 4h ~ max_drawdown).
// Approx saving per token = (rule_exit_return) - (SL_or_worse). We can't know intramin, but bound it:
// If token eventually hit -45% anyway, saving = ret15 - (-45%). If it recovered, rule cost = ret15 - final/peak.
console.log("\n=== Rough P&L impact of exiting all red@15m at their 15m price ===");
const p15=traded.filter(r=>r.price_at_alert>0&&r.price_15m!=null);
const red15=p15.filter(r=>ret(r.price_15m,r.price_at_alert)!<=0);
// counterfactual current engine return proxy: assume SL -45% caps loss, otherwise use a -45% floor or 15m if better?
// We lack final realized price. Use max_drawdown_pct as worst case and 15m as rule-exit.
let ruleSum=0, slFloorSum=0;
for(const r of red15){
  const r15=ret(r.price_15m,r.price_at_alert)!;
  ruleSum+=r15;                                   // rule exits at 15m price
  slFloorSum+=Math.max(r15,-0.45);                // current engine: at best -45% floor, but if already worse at 15m it's worse
}
console.log(`  red@15m n=${red15.length}`);
console.log(`  mean exit return if rule fires at 15m: ${(100*ruleSum/red15.length).toFixed(1)}%`);
console.log(`  mean return if SL -45% floor (optimistic for current engine): ${(100*slFloorSum/red15.length).toFixed(1)}%`);
console.log(`  => avg per-token difference (rule - SLfloor): ${(100*(ruleSum-slFloorSum)/red15.length).toFixed(1)} pts`);
console.log(`     (POSITIVE means rule exits at a BETTER price than a -45% floor on the losers that are above -45% at 15m)`);

// ---- conviction: are winners higher conviction? could a conviction tweak beat the time rule? ----
console.log("\n=== conviction: winners vs losers (traded) ===");
const cw=winners.map(w=>w.conviction).filter(x=>x!=null);
const losers=traded.filter(r=>!WIN(r)).map(r=>r.conviction).filter(x=>x!=null);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
console.log(`  winners conviction mean=${mean(cw).toFixed(2)} (n=${cw.length}); losers mean=${mean(losers).toFixed(2)} (n=${losers.length})`);
