import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql:string,...a:any[])=>db.prepare(sql).get(...a) as any;
const all = (sql:string,...a:any[])=>db.prepare(sql).all(...a) as any[];

// BUY-signal mints: how often does the LATER price feed resolve? (proxy for exit-engine pricing reliability)
const buy = "verdict IN ('BUY_SMALL','BUY_STRONG')";
const n = one(`SELECT COUNT(*) n FROM signals WHERE ${buy}`).n;
console.log("BUY signals:", n);
for (const col of ["price_at_alert","price_5m","price_15m","price_1h","max_gain_pct","max_drawdown_pct","exit_reason","hypothetical_pnl_sol","real_pnl_sol"]) {
  const nn = one(`SELECT COUNT(*) c FROM signals WHERE ${buy} AND ${col} IS NOT NULL`).c;
  console.log(`  ${col}: non-null ${nn}/${n} (${(nn/n*100).toFixed(1)}%)`);
}

// exit_reason distribution for BUY mints
console.log("BUY exit_reason:", JSON.stringify(all(`SELECT COALESCE(exit_reason,'<NULL>') r, COUNT(*) c FROM signals WHERE ${buy} GROUP BY r ORDER BY c DESC`)));

// For BUY mints that HAVE price_at_alert, how many lost the 15m/1h price (feed dropped them)?
const haveAlert = one(`SELECT COUNT(*) c FROM signals WHERE ${buy} AND price_at_alert IS NOT NULL`).c;
const lost15 = one(`SELECT COUNT(*) c FROM signals WHERE ${buy} AND price_at_alert IS NOT NULL AND price_15m IS NULL`).c;
const lost1h = one(`SELECT COUNT(*) c FROM signals WHERE ${buy} AND price_at_alert IS NOT NULL AND price_1h IS NULL`).c;
console.log(`BUY mints priced at alert but NULL @15m: ${lost15}/${haveAlert} (${(lost15/haveAlert*100).toFixed(1)}%), NULL @1h: ${lost1h}/${haveAlert} (${(lost1h/haveAlert*100).toFixed(1)}%)`);

// hypothetical pnl sign distribution
const hp = all(`SELECT CASE WHEN hypothetical_pnl_sol>0 THEN 'pos' WHEN hypothetical_pnl_sol<0 THEN 'neg' WHEN hypothetical_pnl_sol=0 THEN 'zero' ELSE 'null' END s, COUNT(*) c, ROUND(SUM(hypothetical_pnl_sol),3) sum FROM signals WHERE ${buy} GROUP BY s`);
console.log("BUY hypothetical_pnl_sol:", JSON.stringify(hp));
console.log("BUY hypothetical_pnl_sol TOTAL:", one(`SELECT ROUND(SUM(hypothetical_pnl_sol),3) s FROM signals WHERE ${buy}`).s);
