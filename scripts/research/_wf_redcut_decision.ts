/**
 * READ-ONLY: decision-grade framing of the red-cut rule over ALL traded BUYs,
 * not just those with a non-null sample. A live exit engine ALWAYS has a current
 * price, so "NULL sample" is an artifact of forward-sampling, not a real state.
 * We bound the rule's winner-loss two ways:
 *   (a) STRICT among-sampled: of tokens we can classify at H, how many winners are RED.
 *   (b) WORST-CASE over all winners: if a winner has no H sample, we cannot prove
 *       it was green at H -> count it as "unknown". Report unknowns explicitly.
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), {
  readonly: true,
  fileMustExist: true,
});

interface Row {
  symbol: string | null;
  price_at_alert: number | null;
  price_5m: number | null;
  price_15m: number | null;
  max_gain_pct: number | null;
  real_pnl_sol: number | null;
}

const rows = db
  .prepare(
    `SELECT symbol, price_at_alert, price_5m, price_15m, max_gain_pct, real_pnl_sol
     FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`,
  )
  .all() as Row[];

const isWinner = (r: Row): boolean =>
  (r.max_gain_pct != null && r.max_gain_pct >= 100) ||
  (r.real_pnl_sol != null && r.real_pnl_sol > 0);

type Cls = "RED" | "GREEN" | "UNKNOWN";
const classify = (pH: number | null, pa: number | null): Cls => {
  if (pa == null || pa <= 0 || pH == null) return "UNKNOWN";
  return pH - pa <= 0 ? "RED" : "GREEN";
};

// eslint-disable-next-line no-console
const log = (s: string): void => console.log(s);

for (const [label, pick] of [["5m", (r: Row) => r.price_5m], ["15m", (r: Row) => r.price_15m]] as const) {
  const winners = rows.filter(isWinner);
  const cls = winners.map((r) => classify(pick(r), r.price_at_alert));
  const redW = cls.filter((c) => c === "RED").length;
  const greenW = cls.filter((c) => c === "GREEN").length;
  const unkW = cls.filter((c) => c === "UNKNOWN").length;
  log(`Horizon ${label}: of ${winners.length} TOTAL winners -> ` +
    `classified RED=${redW}, GREEN=${greenW}, UNKNOWN(no sample)=${unkW}`);
  log(`  -> winners definitively cut by red-rule: ${redW}`);
  log(`  -> winners that were already GREEN at ${label} (rule keeps them): ${greenW}`);
  log(`  -> winners whose ${label} state is unobserved: ${unkW} ` +
    `(peaked then sampling stopped, or fast rug; cannot confirm green)`);
}

db.close();
