import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const q = (s: string) => db.prepare(s).all() as any[];
const one = (s: string) => db.prepare(s).get() as any;

console.log("=== PAPER WALLET RECONCILIATION ===");
console.log("paper_trades rows:", one("SELECT COUNT(*) c FROM paper_trades").c);
const sells = one("SELECT COUNT(*) c, ROUND(SUM(realized_pnl_sol),4) realized FROM paper_trades WHERE side='sell'");
console.log("sell fills:", sells.c, "| total realized SOL:", sells.realized);
const pos = one("SELECT COUNT(*) total, SUM(CASE WHEN closed_at_ms IS NULL THEN 1 ELSE 0 END) open, SUM(CASE WHEN closed_at_ms IS NOT NULL THEN 1 ELSE 0 END) closed FROM paper_positions");
console.log("positions:", pos);

console.log("\n=== CLOSED PAPER POSITIONS: win/loss + reason visibility ===");
const closed = q("SELECT realized_pnl_usd, entry_at_ms, closed_at_ms, exit_plan FROM paper_positions WHERE closed_at_ms IS NOT NULL");
const wins = closed.filter((p) => p.realized_pnl_usd > 0).length;
console.log("closed:", closed.length, "| wins:", wins, "| winRate:", closed.length ? (wins / closed.length * 100).toFixed(1) + "%" : "n/a");
// distribution of realized usd
const sorted = closed.map((p) => p.realized_pnl_usd).sort((a, b) => a - b);
if (sorted.length) {
  console.log("worst close USD:", sorted[0]?.toFixed(2), "| best:", sorted[sorted.length - 1]?.toFixed(2));
  console.log("sum realized USD:", sorted.reduce((a, b) => a + b, 0).toFixed(2));
}

console.log("\n=== EXIT REASON DISTRIBUTION (paper_trades sells) ===");
const reasons = q("SELECT reason, COUNT(*) c, ROUND(SUM(realized_pnl_sol),3) pnl FROM paper_trades WHERE side='sell' GROUP BY reason ORDER BY c DESC");
for (const r of reasons) console.log(`  ${(r.reason ?? "(null)").padEnd(28)} n=${String(r.c).padStart(4)}  pnlSOL=${r.pnl}`);

console.log("\n=== SIGNAL-LEVEL EXIT REASON (signals.exit_reason) ===");
const sigEx = q("SELECT exit_reason, COUNT(*) c, ROUND(AVG(max_gain_pct),1) avgGain, ROUND(AVG(max_drawdown_pct),1) avgDD FROM signals WHERE exit_reason IS NOT NULL GROUP BY exit_reason ORDER BY c DESC");
for (const r of sigEx) console.log(`  ${(r.exit_reason ?? "(null)").padEnd(22)} n=${String(r.c).padStart(5)}  avgGain=${r.avgGain}%  avgDD=${r.avgDD}%`);

console.log("\n=== BUY SIGNAL OUTCOME TAIL (the loser tail the UI must surface) ===");
const buys = q("SELECT max_gain_pct g, max_drawdown_pct d, price_5m, price_at_alert FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL");
console.log("resolved BUY signals:", buys.length);
if (buys.length) {
  const gains = buys.map((b) => b.g).sort((a, b) => a - b);
  const losers = buys.filter((b) => b.g < 20).length;
  const bigwin = buys.filter((b) => b.g >= 100).length;
  console.log("median peak gain%:", gains[Math.floor(gains.length / 2)]?.toFixed(0));
  console.log("BUYs peaking <20%:", losers, `(${(losers / buys.length * 100).toFixed(0)}%)  | BUYs peaking >=100%:`, bigwin, `(${(bigwin / buys.length * 100).toFixed(0)}%)`);
  // 5m move on buys
  const m5 = buys.filter((b) => b.price_5m && b.price_at_alert > 0).map((b) => (b.price_5m / b.price_at_alert - 1) * 100).sort((a, b) => a - b);
  if (m5.length) console.log("5m-after-alert move: median", m5[Math.floor(m5.length / 2)]?.toFixed(1) + "%", "| p10", m5[Math.floor(m5.length * 0.1)]?.toFixed(1) + "%", "| p90", m5[Math.floor(m5.length * 0.9)]?.toFixed(1) + "%");
}

console.log("\n=== ENTRY LATENCY: is 'bought N min late' visible anywhere? ===");
// columns on signals
const cols = (db.prepare("PRAGMA table_info(signals)").all() as any[]).map((c) => c.name);
console.log("signals cols incl latency?:", cols.filter((c) => /seen|first|age|latency|delay/i.test(c)).join(", ") || "(none)");
const pcols = (db.prepare("PRAGMA table_info(paper_positions)").all() as any[]).map((c) => c.name);
console.log("paper_positions cols incl latency?:", pcols.filter((c) => /seen|first|age|latency|delay/i.test(c)).join(", ") || "(none)");

console.log("\n=== COUNCIL ACCURACY (shown in UI as 'accuracy X%') — sample sizes ===");
const ca = one("SELECT COUNT(*) total, SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) resolved FROM council_opinions");
console.log("council_opinions:", ca);

db.close();
