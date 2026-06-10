// V5.1 P0 verification: re-scored signals must now journal WITH price_at_alert
// (they used to be NULL forever → invisible to outcome tracking/learning).
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const sinceMs = Number(process.argv[2] ?? 10 * 60_000);
const rows = db
  .prepare(
    "SELECT id, symbol, verdict, price_at_alert, flags, at FROM signals WHERE at > ? AND reasons LIKE '%attention re-score%' ORDER BY at DESC LIMIT 10",
  )
  .all(Date.now() - sinceMs);
console.log(`rescored signals in last ${Math.round(sinceMs / 60000)}min: ${rows.length}`);
let priced = 0, flagged = 0;
for (const r of rows) {
  const hasPrice = r.price_at_alert != null && r.price_at_alert > 0;
  const hasFlag = (r.flags || "").includes("research:");
  if (hasPrice) priced++;
  if (hasFlag) flagged++;
  console.log(`  #${r.id} ${r.symbol} ${r.verdict} price_at_alert=${r.price_at_alert} ${hasFlag ? "research-flag✓" : "no-research-flag"}`);
}
console.log(`priced: ${priced}/${rows.length} · research-flagged: ${flagged}/${rows.length}`);
db.close();
