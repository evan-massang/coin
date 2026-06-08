import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const verdictCounts = db.prepare(`SELECT verdict, COUNT(*) c FROM signals GROUP BY verdict ORDER BY c DESC`).all() as any[];
console.log("verdict distribution:", JSON.stringify(verdictCounts));

// scoring verdicts = those with a safety facet (observe-window scoring output)
const multiScore = db.prepare(`SELECT mint, COUNT(*) c FROM signals WHERE json_extract(scores,'$.safety')>0 GROUP BY mint HAVING c>1`).all() as any[];
console.log(`mints with >1 scoring signal (safety>0): ${multiScore.length}`);

// of mints with >1 TOTAL signal, how many of the extras are exit signals?
const exitVerds = db.prepare(`SELECT verdict, COUNT(*) c FROM signals WHERE json_extract(scores,'$.safety') IS NULL OR json_extract(scores,'$.safety')<=0 GROUP BY verdict ORDER BY c DESC`).all() as any[];
console.log("non-scoring (exit/other) verdicts:", JSON.stringify(exitVerds));

// early-trigger: any scoring signal decided <60s after first_seen?
const fast = db.prepare(`
  SELECT COUNT(*) c FROM signals s JOIN tokens t ON s.mint=t.mint
  WHERE json_extract(s.scores,'$.safety')>0 AND (s.at - t.first_seen_at) < 60000 AND (s.at - t.first_seen_at) >= 0
`).all() as any[];
const tot = db.prepare(`SELECT COUNT(*) c FROM signals s JOIN tokens t ON s.mint=t.mint WHERE json_extract(s.scores,'$.safety')>0`).all() as any[];
console.log(`scoring signals decided <60s after first_seen (early-trigger evidence): ${fast[0].c} / ${tot[0].c}`);

db.close();
