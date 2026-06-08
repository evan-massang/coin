import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// Breakdown: for mints with >1 total signal, what are the verdicts?
const verdictCounts = db.prepare(`SELECT verdict, COUNT(*) c FROM signals GROUP BY verdict ORDER BY c DESC`).all() as any[];
console.log("verdict distribution:", JSON.stringify(verdictCounts));

// scoring verdicts only (the observe-window decision set)
const scoringVerdicts = ["BUY_SMALL","BUY_STRONG","WATCH","AVOID"];
const placeholders = scoringVerdicts.map(()=>"?").join(",");
const multiScore = db.prepare(`SELECT mint, COUNT(*) c FROM signals WHERE verdict IN (${placeholders}) GROUP BY mint HAVING c>1`).all(...scoringVerdicts) as any[];
console.log(`mints with >1 SCORING verdict (BUY/WATCH/AVOID): ${multiScore.length}`);
if (multiScore.length) console.log("examples:", multiScore.slice(0,5));

// also: distinct verdict-time check — is the early-trigger ever reflected (a scoring signal at <60s latency)?
const fast = db.prepare(`
  SELECT COUNT(*) c FROM signals s JOIN tokens t ON s.mint=t.mint
  WHERE s.verdict IN (${placeholders}) AND (s.at - t.first_seen_at) < 60000 AND (s.at - t.first_seen_at) >= 0
`).all(...scoringVerdicts) as any[];
const totalScore = db.prepare(`SELECT COUNT(*) c FROM signals s JOIN tokens t ON s.mint=t.mint WHERE s.verdict IN (${placeholders})`).all(...scoringVerdicts) as any[];
console.log(`scoring signals decided <60s after first_seen (would indicate early-trigger fired): ${fast[0].c} / ${totalScore[0].c}`);

db.close();
