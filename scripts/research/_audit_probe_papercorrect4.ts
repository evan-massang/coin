import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql:string,...a:any[])=>db.prepare(sql).get(...a) as any;
const all = (sql:string,...a:any[])=>db.prepare(sql).all(...a) as any[];

// exit reason distribution in sells
console.log("SELL reasons:", JSON.stringify(all("SELECT reason, COUNT(*) n, ROUND(SUM(realized_pnl_sol),4) pnl FROM paper_trades WHERE side='sell' GROUP BY reason ORDER BY n DESC")));
console.log("BUY reasons:", JSON.stringify(all("SELECT reason, COUNT(*) n FROM paper_trades WHERE side='buy' GROUP BY reason")));

// CLOSED winrate via realized_pnl_usd
const closed = all("SELECT realized_pnl_usd r FROM paper_positions WHERE status='CLOSED'");
const wins = closed.filter(c=>c.r>0).length;
console.log("CLOSED:", closed.length, "wins(realized_pnl_usd>0):", wins, "winRate:", (wins/closed.length*100).toFixed(1)+"%");
// distribution of closed realized usd
const rs = closed.map(c=>c.r).sort((a,b)=>a-b);
console.log("closed realized_usd min/median/max:", rs[0]?.toFixed(2), rs[Math.floor(rs.length/2)]?.toFixed(2), rs[rs.length-1]?.toFixed(2));
console.log("closed with realized_pnl_usd == 0 exactly:", closed.filter(c=>c.r===0).length);

// Signals reconciliation
try {
  const sigCounts = all("SELECT verdict, COUNT(*) n FROM signals GROUP BY verdict ORDER BY n DESC");
  console.log("SIGNALS by verdict:", JSON.stringify(sigCounts));
  const buySig = one("SELECT COUNT(*) n, COUNT(DISTINCT mint) dm FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')");
  console.log("BUY signals total=", buySig.n, "distinct mints=", buySig.dm);
  // how many BUY-signal mints have a paper position?
  const matched = one(`SELECT COUNT(DISTINCT s.mint) n FROM signals s WHERE s.verdict IN ('BUY_SMALL','BUY_STRONG') AND s.mint IN (SELECT mint FROM paper_positions)`).n;
  console.log("BUY-signal distinct mints that became a paper position:", matched, "=> dropped:", buySig.dm - matched);
  // time window of signals vs paper
  const sigT = one("SELECT MIN(at) a, MAX(at) b FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')");
  console.log("BUY signal window:", new Date(sigT.a).toISOString(), "->", new Date(sigT.b).toISOString());
  const papT = one("SELECT MIN(at) a, MAX(at) b FROM paper_trades WHERE side='buy'");
  console.log("paper buy window: ", new Date(papT.a).toISOString(), "->", new Date(papT.b).toISOString());
} catch(e){ console.log("signals probe err:", (e as Error).message); }

// any positions with non-finite / absurd prices (Infinity from solUsd=0 bug)
const bad = all("SELECT id,mint,entry_price_usd e,last_price_usd l,peak_price_usd p FROM paper_positions WHERE entry_price_usd<=0 OR last_price_usd<=0 OR last_price_usd > entry_price_usd*1000 OR peak_price_usd > entry_price_usd*1000");
console.log("positions with zero/absurd prices:", bad.length);
bad.slice(0,5).forEach(b=>console.log("  ", b.mint.slice(0,8), "e=",b.e,"l=",b.l,"p=",b.p));
