import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function q(label: string, sql: string) {
  try {
    const rows = db.prepare(sql).all();
    console.log(`\n== ${label} ==`);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.log(`\n== ${label} == ERROR: ${(e as Error).message}`);
  }
}

// Current open positions
q("paper_positions open now (closed_at_ms IS NULL)", `
  SELECT COUNT(*) AS open_now FROM paper_positions WHERE closed_at_ms IS NULL
`);

q("paper_positions total + closed", `
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN closed_at_ms IS NULL THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN closed_at_ms IS NOT NULL THEN 1 ELSE 0 END) AS closed
  FROM paper_positions
`);

// Peak concurrency: for each position, count how many other positions had an
// overlapping open interval. Use entry_at_ms .. closed_at_ms (or now if open).
q("peak concurrent open positions (overlap analysis)", `
  WITH ev AS (
    SELECT entry_at_ms AS t, 1 AS d FROM paper_positions WHERE entry_at_ms IS NOT NULL
    UNION ALL
    SELECT COALESCE(closed_at_ms, (SELECT MAX(closed_at_ms) FROM paper_positions)) AS t, -1 AS d
    FROM paper_positions WHERE entry_at_ms IS NOT NULL
  ),
  running AS (
    SELECT t, SUM(d) OVER (ORDER BY t, d DESC ROWS UNBOUNDED PRECEDING) AS concurrent
    FROM ev
  )
  SELECT MAX(concurrent) AS peak_concurrent FROM running
`);

q("learning_features count", `SELECT COUNT(*) AS n FROM learning_features`);

q("signals count", `SELECT COUNT(*) AS n FROM signals`);

// hold duration distribution (minutes) for closed positions
q("hold-time minutes (closed positions) percentiles-ish", `
  SELECT
    COUNT(*) AS closed_n,
    ROUND(AVG((closed_at_ms - entry_at_ms)/60000.0),1) AS avg_min,
    ROUND(MAX((closed_at_ms - entry_at_ms)/60000.0),1) AS max_min,
    ROUND(MIN((closed_at_ms - entry_at_ms)/60000.0),1) AS min_min
  FROM paper_positions WHERE closed_at_ms IS NOT NULL AND entry_at_ms IS NOT NULL
`);

// time span of data
q("data span (entry_at_ms)", `
  SELECT
    MIN(entry_at_ms) AS first_ms,
    MAX(entry_at_ms) AS last_ms,
    ROUND((MAX(entry_at_ms)-MIN(entry_at_ms))/3600000.0,1) AS span_hours
  FROM paper_positions WHERE entry_at_ms IS NOT NULL
`);

db.close();
