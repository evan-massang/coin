import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// Verdict mix among council-reviewed mints (any outcome state)
const rows = db
  .prepare(
    `WITH co AS (SELECT DISTINCT mint FROM council_opinions),
          sig AS (SELECT mint, verdict, max_gain_pct g,
                         ROW_NUMBER() OVER (PARTITION BY mint ORDER BY (max_gain_pct IS NOT NULL) DESC, at DESC) rn
                    FROM signals)
     SELECT sig.verdict, COUNT(*) n,
            SUM(CASE WHEN sig.g IS NOT NULL THEN 1 ELSE 0 END) resolved
       FROM co JOIN sig ON sig.mint=co.mint AND sig.rn=1
      GROUP BY sig.verdict ORDER BY n DESC`,
  )
  .all() as any[];
console.log("Verdict mix among the 44 council-reviewed mints:");
for (const r of rows) console.log(`  ${r.verdict}: mints=${r.n} resolved=${r.resolved}`);

// Council coverage vs total signals: what fraction of decisions ever got a council?
const totalMints = db.prepare("SELECT COUNT(DISTINCT mint) n FROM signals").get() as any;
const coMints = db.prepare("SELECT COUNT(DISTINCT mint) n FROM council_opinions").get() as any;
console.log(`\nCouncil coverage: ${coMints.n} / ${totalMints.n} distinct mints (${((100*coMints.n)/totalMints.n).toFixed(1)}%)`);

// Among traded BUYs, how many ever got a council opinion?
const buyMints = db.prepare("SELECT COUNT(DISTINCT mint) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')").get() as any;
const buyWithCouncil = db.prepare(
  "SELECT COUNT(DISTINCT s.mint) n FROM signals s JOIN council_opinions c ON c.mint=s.mint WHERE s.verdict IN ('BUY_SMALL','BUY_STRONG')").get() as any;
console.log(`Traded BUY mints: ${buyMints.n}; of those with ANY council opinion: ${buyWithCouncil.n}`);

// Conviction range overall (is 59 truly the ceiling for BUYs)
const mx = db.prepare("SELECT MAX(conviction) mx, MIN(conviction) mn FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')").get() as any;
console.log(`\nTraded conviction range: min=${mx.mn} max=${mx.mx}`);
const anyStrong = db.prepare("SELECT COUNT(*) n FROM signals WHERE verdict='BUY_STRONG'").get() as any;
console.log(`BUY_STRONG rows ever: ${anyStrong.n}`);

db.close();
