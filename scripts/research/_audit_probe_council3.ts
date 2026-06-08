import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const q = (sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as Record<string, unknown>[];
const one = (sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as Record<string, unknown> | undefined;

console.log("=== role per seat + confirm bias ===");
for (const r of q(`SELECT member_id, role, COUNT(*) n,
   SUM(CASE WHEN recommendation='confirm' THEN 1 ELSE 0 END) confirm FROM council_opinions GROUP BY member_id`)) {
  console.log(`${String(r.member_id).padEnd(10)} role=${String(r.role).padEnd(18)} confirm ${r.confirm}/${r.n} = ${(Number(r.confirm)/Number(r.n)*100).toFixed(0)}%`);
}

console.log("\n=== What verdict did the engine give the coins the council debated? ===");
// Each debated mint: latest engine verdict for that mint.
const rows = q(`SELECT co.mint,
    (SELECT verdict FROM signals s WHERE s.mint=co.mint ORDER BY s.at DESC LIMIT 1) verdict
  FROM (SELECT DISTINCT mint FROM council_opinions) co`);
const byVerdict: Record<string, number> = {};
for (const r of rows) {
  const v = (r.verdict as string) ?? "NO_SIGNAL";
  byVerdict[v] = (byVerdict[v] ?? 0) + 1;
}
console.log("debated mints by engine verdict:", JSON.stringify(byVerdict, null, 0));
const total = rows.length;
const buyish = (byVerdict["BUY_SMALL"] ?? 0) + (byVerdict["BUY_STRONG"] ?? 0);
console.log(`debated mints that were ever BUY-rated: ${buyish}/${total} = ${(buyish/total*100).toFixed(1)}%`);

console.log("\n=== BUY -> first council opinion delay (overlapping mints) ===");
const delays = q(`SELECT s.mint, MIN(s.at) buy_at, (SELECT MIN(co.at) FROM council_opinions co WHERE co.mint=s.mint) co_at
   FROM signals s WHERE s.verdict LIKE 'BUY%' GROUP BY s.mint
   HAVING co_at IS NOT NULL`)
  .map((r) => (Number(r.co_at) - Number(r.buy_at)) / 60000)
  .sort((a, b) => a - b);
if (delays.length) {
  const med = delays[Math.floor(delays.length / 2)];
  console.log(`overlapping mints=${delays.length} | min=${delays[0].toFixed(1)}min median=${med.toFixed(1)}min max=${delays[delays.length-1].toFixed(1)}min`);
  console.log(`negative (council BEFORE buy): ${delays.filter((d) => d < 0).length}`);
}

console.log("\n=== Volume / throughput (always-on cost) ===");
const span = one("SELECT MIN(at) lo, MAX(at) hi, COUNT(*) c, COUNT(DISTINCT mint) m FROM council_opinions");
const hours = (Number(span?.hi) - Number(span?.lo)) / 3600000;
console.log(`window=${hours.toFixed(1)}h opinions=${span?.c} mints=${span?.m}`);
console.log(`=> ${(Number(span?.c)/hours).toFixed(1)} LLM inferences/hour just for advisory debate (5 local seats x rounds)`);
// births available to debate vs debated
const births = one("SELECT COUNT(*) c FROM tokens");
console.log(`tokens seen total: ${births?.c} | distinct debated: ${span?.m}`);

db.close();
