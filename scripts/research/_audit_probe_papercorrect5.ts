import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql:string,...a:any[])=>db.prepare(sql).get(...a) as any;
const all = (sql:string,...a:any[])=>db.prepare(sql).all(...a) as any[];

const w = one("SELECT * FROM paper_wallet");
console.log("LIVE wallet:", JSON.stringify(w), " created=", new Date(w.created_at).toISOString());
console.log("LIVE positions:", JSON.stringify(all("SELECT status,COUNT(*) n FROM paper_positions GROUP BY status")));
console.log("LIVE trades:", JSON.stringify(all("SELECT side,COUNT(*) n FROM paper_trades GROUP BY side")));

// duplicate sell detection: same mint+at (within fill), or two sells closing same position
const dupSell = all(`SELECT mint, at, COUNT(*) n FROM paper_trades WHERE side='sell' GROUP BY mint, at HAVING COUNT(*)>1`);
console.log("duplicate (mint,at) sells current:", dupSell.length);

// signals table structure
console.log("signals columns:", db.prepare("PRAGMA table_info(signals)").all().map((c:any)=>c.name).join(","));
console.log("signals total:", one("SELECT COUNT(*) n FROM signals").n, " distinct mints:", one("SELECT COUNT(DISTINCT mint) n FROM signals").n);
// is signals one-row-per-mint? check max rows per mint
console.log("max signals per mint:", one("SELECT MAX(c) m FROM (SELECT mint,COUNT(*) c FROM signals GROUP BY mint)").m);
console.log("mints with >1 signal:", one("SELECT COUNT(*) n FROM (SELECT mint,COUNT(*) c FROM signals GROUP BY mint HAVING c>1)").n);

// signals per hour for BUY verdicts (last 6h buckets)
const buyByHour = all(`SELECT CAST((MAX(at) - at)/3600000 AS INT) hago, COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG'), (SELECT MAX(at) FROM signals) GROUP BY hago`);
