import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const g = (s: string, ...a: any[]) => db.prepare(s).get(...a) as any;

console.log("paper_trades total:", g("SELECT COUNT(*) n FROM paper_trades").n);
console.log("paper_trades by side:", JSON.stringify(db.prepare("SELECT side, COUNT(*) n FROM paper_trades GROUP BY side").all()));
console.log("paper_positions total:", g("SELECT COUNT(*) n FROM paper_positions").n);
console.log("paper_positions closed (closed_at_ms NOT NULL):", g("SELECT COUNT(*) n FROM paper_positions WHERE closed_at_ms IS NOT NULL").n);
console.log("signals total:", g("SELECT COUNT(*) n FROM signals").n);
console.log("signals by verdict:", JSON.stringify(db.prepare("SELECT verdict, COUNT(*) n FROM signals GROUP BY verdict ORDER BY n DESC").all()));
// weight movement check: with 13 resolved >= MIN_RESOLVED_FOR_WEIGHT(8), accuracy*1.5+0.25 clamp
const ms = db.prepare(`SELECT member_id,
  SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) resolved,
  SUM(CASE WHEN (recommendation='confirm' AND outcome='win') OR (recommendation='caution' AND outcome='loss') THEN 1 ELSE 0 END) correct
  FROM council_opinions GROUP BY member_id`).all() as any[];
console.log("\n=== implied weights (resolved>=8 ? clamp(acc*1.5+0.25,0.4,1.6):1) ===");
for (const r of ms) {
  const acc = r.resolved ? r.correct/r.resolved : 0;
  const w = r.resolved>=8 ? Math.max(0.4, Math.min(1.6, acc*1.5+0.25)) : 1;
  console.log(`${r.member_id}: resolved=${r.resolved} acc=${acc.toFixed(2)} weight=${w.toFixed(2)}`);
}
db.close();
