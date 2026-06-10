// How many GRADUATED seeds (golden-filter or real-DEX-pair coins) are available
// for a discovery hunt right now?
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const n = db
  .prepare(
    "SELECT COUNT(DISTINCT mint) n FROM signals WHERE at > ? AND verdict IN ('BUY_SMALL','BUY_STRONG','WATCH_ONLY') AND (flags LIKE '%src:scan%' OR pair_created_at IS NOT NULL)",
  )
  .get(Date.now() - 45 * 60_000);
console.log("graduated seeds (45min):", n.n);
const sample = db
  .prepare(
    "SELECT DISTINCT mint, symbol, verdict, conviction FROM signals WHERE at > ? AND verdict IN ('BUY_SMALL','BUY_STRONG','WATCH_ONLY') AND (flags LIKE '%src:scan%' OR pair_created_at IS NOT NULL) ORDER BY at DESC LIMIT 8",
  )
  .all(Date.now() - 45 * 60_000);
for (const s of sample) console.log(` $${s.symbol} ${s.verdict}@${s.conviction} ${s.mint.slice(0, 10)}...`);
db.close();
