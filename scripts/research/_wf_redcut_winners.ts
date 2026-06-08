/**
 * READ-ONLY: inspect ALL 9 winners among traded BUYs to confirm the red-cut
 * rule's behavior and check for sample-availability bias (winners with NULL
 * forward samples that the horizon analysis silently excludes).
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), {
  readonly: true,
  fileMustExist: true,
});

interface Row {
  symbol: string | null;
  verdict: string;
  conviction: number | null;
  price_at_alert: number | null;
  price_5m: number | null;
  price_15m: number | null;
  price_1h: number | null;
  max_gain_pct: number | null;
  real_pnl_sol: number | null;
}

const rows = db
  .prepare(
    `SELECT symbol, verdict, conviction, price_at_alert, price_5m, price_15m, price_1h,
            max_gain_pct, real_pnl_sol
     FROM signals
     WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
       AND ((max_gain_pct IS NOT NULL AND max_gain_pct>=100) OR (real_pnl_sol IS NOT NULL AND real_pnl_sol>0))
     ORDER BY max_gain_pct DESC`,
  )
  .all() as Row[];

const ret = (p: number | null, pa: number | null): string => {
  if (pa == null || pa <= 0 || p == null) return "NULL";
  return `${(((p - pa) / pa) * 100).toFixed(1)}%`;
};

// eslint-disable-next-line no-console
const log = (s: string): void => console.log(s);

log(`ALL ${rows.length} winners among traded BUYs:`);
log(`symbol | conv | maxgain | pnl | ret5m | ret15m | ret1h | (5m/15m green?)`);
for (const r of rows) {
  const r5 = ret(r.price_5m, r.price_at_alert);
  const r15 = ret(r.price_15m, r.price_at_alert);
  const r1h = ret(r.price_1h, r.price_at_alert);
  const green5 = r.price_5m != null && r.price_at_alert != null && r.price_at_alert > 0
    ? (r.price_5m > r.price_at_alert ? "G5" : "R5") : "?5";
  const green15 = r.price_15m != null && r.price_at_alert != null && r.price_at_alert > 0
    ? (r.price_15m > r.price_at_alert ? "G15" : "R15") : "?15";
  log(
    `${r.symbol ?? "?"} | conv=${r.conviction ?? "?"} | max_gain=${r.max_gain_pct?.toFixed(0) ?? "?"}% | ` +
      `pnl=${r.real_pnl_sol ?? "null"} | 5m=${r5} | 15m=${r15} | 1h=${r1h} | [${green5} ${green15}]`,
  );
}

// Sample-availability bias check
const winNull5 = rows.filter((r) => r.price_5m == null || r.price_at_alert == null || r.price_at_alert <= 0).length;
const winNull15 = rows.filter((r) => r.price_15m == null || r.price_at_alert == null || r.price_at_alert <= 0).length;
log("");
log(`winners with NO usable 5m sample (excluded from 5m analysis): ${winNull5}`);
log(`winners with NO usable 15m sample (excluded from 15m analysis): ${winNull15}`);

db.close();
