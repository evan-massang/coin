import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function one(sql: string): any {
  try { return db.prepare(sql).get(); } catch (e) { return { error: String(e) }; }
}

console.log("paper_positions:", JSON.stringify(one("SELECT COUNT(*) c FROM paper_positions")));
console.log("paper_trades:", JSON.stringify(one("SELECT COUNT(*) c FROM paper_trades")));
console.log("paper_price_samples:", JSON.stringify(one("SELECT COUNT(*) c FROM paper_price_samples")));

const tbl = one("SELECT name FROM sqlite_master WHERE type='table' AND name='setting_change_log'");
console.log("setting_change_log table:", JSON.stringify(tbl));
if (tbl && (tbl as any).name) {
  console.log("scl count:", JSON.stringify(one("SELECT COUNT(*) c FROM setting_change_log")));
  const cols = db.prepare("PRAGMA table_info(setting_change_log)").all();
  console.log("scl cols:", JSON.stringify(cols));
  console.log("scl newest 3:", JSON.stringify(db.prepare("SELECT * FROM setting_change_log ORDER BY rowid DESC LIMIT 3").all()));
}

console.log("signals total:", JSON.stringify(one("SELECT COUNT(*) c FROM signals")));
console.log("BUY fwd-null:", JSON.stringify(one("SELECT COUNT(*) total, SUM(CASE WHEN price_5m IS NULL THEN 1 ELSE 0 END) null5m, SUM(CASE WHEN price_15m IS NULL THEN 1 ELSE 0 END) null15m, SUM(CASE WHEN price_1h IS NULL THEN 1 ELSE 0 END) null1h FROM signals WHERE verdict LIKE 'BUY%'")));

db.close();
