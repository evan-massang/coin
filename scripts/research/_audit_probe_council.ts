import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function q(sql: string, ...args: unknown[]) {
  return db.prepare(sql).all(...args) as Record<string, unknown>[];
}
function one(sql: string, ...args: unknown[]) {
  return db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
}

console.log("=== TABLES present ===");
const tables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);
console.log(tables.join(", "));

const hasCouncil = tables.includes("council_opinions");
console.log("\n=== council_opinions exists:", hasCouncil, "===");

if (hasCouncil) {
  const cols = q("PRAGMA table_info(council_opinions)").map((r) => r.name);
  console.log("cols:", cols.join(", "));

  const tot = one("SELECT COUNT(*) c, COUNT(DISTINCT mint) m, COUNT(DISTINCT member_id) seats FROM council_opinions");
  console.log("total opinions:", tot?.c, "| distinct mints:", tot?.m, "| distinct seats:", tot?.seats);

  const span = one("SELECT MIN(at) lo, MAX(at) hi FROM council_opinions");
  if (span?.lo) {
    const lo = new Date(Number(span.lo)).toISOString();
    const hi = new Date(Number(span.hi)).toISOString();
    console.log("time span:", lo, "->", hi);
  }

  const resolved = one("SELECT SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) r, COUNT(*) c FROM council_opinions");
  console.log("resolved opinions:", resolved?.r, "/", resolved?.c);

  console.log("\n--- per-seat counts ---");
  for (const r of q("SELECT member_id, label, model, COUNT(*) n, SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) res FROM council_opinions GROUP BY member_id ORDER BY n DESC")) {
    console.log(`${r.member_id} | ${r.label} | ${r.model} | n=${r.n} resolved=${r.res}`);
  }

  console.log("\n--- recommendation x outcome (resolved only) ---");
  for (const r of q("SELECT recommendation, outcome, COUNT(*) n FROM council_opinions WHERE outcome IS NOT NULL GROUP BY recommendation, outcome")) {
    console.log(`${r.recommendation} -> ${r.outcome}: ${r.n}`);
  }

  // confirm precision: of confirm opinions that resolved, what fraction were wins?
  const conf = one("SELECT SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) w, COUNT(*) n FROM council_opinions WHERE recommendation='confirm' AND outcome IS NOT NULL");
  const caut = one("SELECT SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) w, COUNT(*) n FROM council_opinions WHERE recommendation='caution' AND outcome IS NOT NULL");
  console.log(`\nconfirm win-rate: ${conf?.w}/${conf?.n}`, conf?.n ? `= ${(Number(conf.w) / Number(conf.n) * 100).toFixed(1)}%` : "");
  console.log(`caution win-rate: ${caut?.w}/${caut?.n}`, caut?.n ? `= ${(Number(caut.w) / Number(caut.n) * 100).toFixed(1)}%` : "");
}

// === COVERAGE: did council debate the coins we actually traded? ===
console.log("\n=== COVERAGE: council vs traded BUYs ===");
const sigTables = tables.includes("signals");
if (sigTables) {
  const verdicts = q("SELECT verdict, COUNT(*) n FROM signals GROUP BY verdict ORDER BY n DESC");
  console.log("signals by verdict:", verdicts.map((r) => `${r.verdict}=${r.n}`).join(", "));
}

if (tables.includes("paper_positions")) {
  const pp = one("SELECT COUNT(*) c, COUNT(DISTINCT mint) m FROM paper_positions");
  console.log("paper_positions:", pp?.c, "| distinct mints:", pp?.m);

  if (hasCouncil) {
    // Of distinct mints that were actually BOUGHT (paper_positions), how many have ANY council opinion?
    const overlap = one(`SELECT COUNT(DISTINCT pp.mint) m
      FROM paper_positions pp
      WHERE EXISTS (SELECT 1 FROM council_opinions co WHERE co.mint = pp.mint)`);
    const totalBought = one("SELECT COUNT(DISTINCT mint) m FROM paper_positions");
    console.log(`bought mints with ANY council opinion: ${overlap?.m} / ${totalBought?.m}`);

    // Of council-debated mints, how many were ever bought?
    const debatedBought = one(`SELECT COUNT(DISTINCT co.mint) m
      FROM council_opinions co
      WHERE EXISTS (SELECT 1 FROM paper_positions pp WHERE pp.mint = co.mint)`);
    const totalDebated = one("SELECT COUNT(DISTINCT mint) m FROM council_opinions");
    console.log(`debated mints that were ever bought: ${debatedBought?.m} / ${totalDebated?.m}`);
  }
}

// Of BUY signals, how many got council opinions, and was opinion recorded BEFORE or AFTER trade?
if (hasCouncil && sigTables) {
  const buyVerdicts = q("SELECT DISTINCT verdict FROM signals WHERE verdict LIKE 'BUY%'").map((r) => r.verdict);
  console.log("\nBUY verdict labels:", buyVerdicts.join(", "));
  const buyMints = one(`SELECT COUNT(DISTINCT mint) m FROM signals WHERE verdict LIKE 'BUY%'`);
  const buyWithCouncil = one(`SELECT COUNT(DISTINCT s.mint) m FROM signals s
    WHERE s.verdict LIKE 'BUY%' AND EXISTS (SELECT 1 FROM council_opinions co WHERE co.mint = s.mint)`);
  console.log(`BUY-verdict mints with any council opinion: ${buyWithCouncil?.m} / ${buyMints?.m}`);

  // Timing: for mints with both a BUY signal and a council opinion, was the council opinion AFTER the signal?
  const timing = q(`SELECT s.mint, MIN(s.at) sig_at, MIN(co.at) co_at
    FROM signals s JOIN council_opinions co ON co.mint=s.mint
    WHERE s.verdict LIKE 'BUY%'
    GROUP BY s.mint`);
  let after = 0, before = 0;
  for (const r of timing) {
    if (Number(r.co_at) >= Number(r.sig_at)) after++; else before++;
  }
  console.log(`council opinion timing vs BUY signal: ${before} BEFORE, ${after} AT/AFTER (of ${timing.length} overlapping mints)`);
}

db.close();
