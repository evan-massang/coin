/** READ-ONLY baseline: realized paper PnL + per-trade, the "before" for the new exit.
 *   npx tsx scripts/research/_audit_paperpnl.ts */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
const has = (t: string) => tbls.some((x) => x.name === t);

if (has("paper_trades")) {
  const sells = db.prepare("SELECT realized_pnl_sol AS p, at FROM paper_trades WHERE side='sell' AND realized_pnl_sol IS NOT NULL").all() as { p: number; at: number }[];
  const tot = sells.reduce((s, x) => s + x.p, 0);
  const wins = sells.filter((x) => x.p > 0).length;
  console.log(`paper SELL fills: ${sells.length}  realized PnL total: ${tot.toFixed(3)} SOL  win%: ${sells.length ? ((wins / sells.length) * 100).toFixed(1) : "0"}  mean/sell: ${sells.length ? (tot / sells.length).toFixed(4) : "0"} SOL`);
  if (sells.length) { const newest = Math.max(...sells.map((x) => x.at)); console.log(`newest sell at: ${new Date(newest).toISOString().slice(11, 19)} UTC`); }
}
if (has("paper_positions")) {
  const open = (db.prepare("SELECT COUNT(*) n FROM paper_positions WHERE closed_at_ms IS NULL").get() as { n: number }).n;
  const closed = (db.prepare("SELECT COUNT(*) n FROM paper_positions WHERE closed_at_ms IS NOT NULL").get() as { n: number }).n;
  console.log(`paper positions: ${open} open, ${closed} closed`);
}
const bs = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN max_gain_pct>=100 THEN 1 ELSE 0 END) w FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL").get() as { n: number; w: number };
console.log(`signal buyStats: ${bs.n} resolved BUYs, ${bs.w} reached 2x (${bs.n ? ((bs.w / bs.n) * 100).toFixed(1) : "0"}%)`);
db.close();
