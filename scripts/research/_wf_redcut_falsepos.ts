/**
 * READ-ONLY false-positive analysis of an "early-exit if RED at horizon H" rule.
 *
 * Question: among TRADED BUYs that are RED at H (return<=0), how many were
 * WINNERS (max_gain_pct>=100 OR real_pnl_sol>0)? That count is the number of
 * winners the "cut if red at H" rule would throw away (false positives).
 *
 * Horizons: 5m, 15m (no 10m column exists). Also reports the base rate of
 * winners overall and among GREEN-at-H tokens.
 *
 * Run: npx tsx scripts/research/_wf_redcut_falsepos.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), {
  readonly: true,
  fileMustExist: true,
});

const TRADED = "verdict IN ('BUY_SMALL','BUY_STRONG')";

interface Row {
  symbol: string | null;
  verdict: string;
  conviction: number | null;
  price_at_alert: number | null;
  price_5m: number | null;
  price_15m: number | null;
  price_1h: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
  real_pnl_sol: number | null;
  at: number | null;
}

const rows = db
  .prepare(
    `SELECT symbol, verdict, conviction, price_at_alert, price_5m, price_15m, price_1h,
            max_gain_pct, max_drawdown_pct, real_pnl_sol, at
     FROM signals WHERE ${TRADED}`,
  )
  .all() as Row[];

const isWinner = (r: Row): boolean =>
  (r.max_gain_pct != null && r.max_gain_pct >= 100) ||
  (r.real_pnl_sol != null && r.real_pnl_sol > 0);

const ret = (r: Row, pH: number | null): number | null => {
  if (r.price_at_alert == null || r.price_at_alert <= 0) return null;
  if (pH == null) return null;
  return (pH - r.price_at_alert) / r.price_at_alert;
};

const totalBuys = rows.length;
const overallWinners = rows.filter(isWinner).length;

// eslint-disable-next-line no-console
const log = (s: string): void => console.log(s);

log(`=== TRADED BUYs (verdict IN BUY_SMALL,BUY_STRONG) ===`);
log(`total traded BUYs: ${totalBuys}`);
log(
  `overall winners (max_gain>=100 OR real_pnl_sol>0): ${overallWinners} ` +
    `(${((overallWinners / totalBuys) * 100).toFixed(1)}% base rate)`,
);
// breakdown of the winner definition
const winByGain = rows.filter((r) => r.max_gain_pct != null && r.max_gain_pct >= 100).length;
const winByPnl = rows.filter((r) => r.real_pnl_sol != null && r.real_pnl_sol > 0).length;
const withPnl = rows.filter((r) => r.real_pnl_sol != null).length;
const withGain = rows.filter((r) => r.max_gain_pct != null).length;
log(
  `  winners via max_gain>=100: ${winByGain} (of ${withGain} w/ non-null gain); ` +
    `via real_pnl_sol>0: ${winByPnl} (of ${withPnl} w/ non-null pnl)`,
);
log("");

interface HResult {
  label: string;
  nSample: number;
  redN: number;
  redWinners: number;
  greenN: number;
  greenWinners: number;
}

const analyze = (label: string, pick: (r: Row) => number | null): HResult => {
  const withSample = rows.filter((r) => pick(r) != null && r.price_at_alert != null && r.price_at_alert > 0);
  const red = withSample.filter((r) => (ret(r, pick(r)) as number) <= 0);
  const green = withSample.filter((r) => (ret(r, pick(r)) as number) > 0);
  return {
    label,
    nSample: withSample.length,
    redN: red.length,
    redWinners: red.filter(isWinner).length,
    greenN: green.length,
    greenWinners: green.filter(isWinner).length,
  };
};

const horizons: HResult[] = [
  analyze("5m", (r) => r.price_5m),
  analyze("15m", (r) => r.price_15m),
];

for (const h of horizons) {
  log(`=== Horizon ${h.label} ===`);
  log(`  n with non-null price_${h.label} sample (and valid entry): ${h.nSample}`);
  log(`  RED@${h.label}:   n=${h.redN}  winners=${h.redWinners}  ` +
    `false-positive rate of "cut if red"=${h.redN ? ((h.redWinners / h.redN) * 100).toFixed(1) : "n/a"}%`);
  log(`  GREEN@${h.label}: n=${h.greenN}  winners=${h.greenWinners}  ` +
    `winrate=${h.greenN ? ((h.greenWinners / h.greenN) * 100).toFixed(1) : "n/a"}%`);
  // Distribution detail for red winners (so we can see WHAT we'd lose)
  const redWinnerRows = rows
    .filter((r) => {
      const v = h.label === "5m" ? r.price_5m : r.price_15m;
      return v != null && r.price_at_alert != null && r.price_at_alert > 0 &&
        (ret(r, v) as number) <= 0 && isWinner(r);
    });
  if (redWinnerRows.length > 0) {
    log(`  RED@${h.label} winners detail (these would be wrongly cut):`);
    for (const r of redWinnerRows) {
      const v = h.label === "5m" ? r.price_5m : r.price_15m;
      log(
        `    ${r.symbol ?? "?"} ret@${h.label}=${((ret(r, v) as number) * 100).toFixed(1)}% ` +
          `max_gain=${r.max_gain_pct?.toFixed(0) ?? "?"}% real_pnl=${r.real_pnl_sol ?? "null"}SOL`,
      );
    }
  }
  log("");
}

// Mean/median returns for sanity vs scouting finding
const stats = (label: string, pick: (r: Row) => number | null): void => {
  const vals = rows
    .map((r) => ret(r, pick(r)))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  if (vals.length === 0) {
    log(`  ${label}: no samples`);
    return;
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const median = vals[Math.floor(vals.length / 2)];
  const upPct = (vals.filter((x) => x > 0).length / vals.length) * 100;
  log(
    `  ${label}: n=${vals.length} mean=${(mean * 100).toFixed(1)}% ` +
      `median=${(median * 100).toFixed(1)}% up=${upPct.toFixed(1)}%`,
  );
};

log(`=== Sanity: forward returns (vs scouting finding) ===`);
stats("5m", (r) => r.price_5m);
stats("15m", (r) => r.price_15m);
stats("1h", (r) => r.price_1h);

db.close();
