import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Row = {
  verdict: string;
  price_at_alert: number | null;
  price_15m: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
};

const rows = db.prepare(
  `SELECT verdict, price_at_alert, price_15m, max_gain_pct, max_drawdown_pct
     FROM signals
    WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
      AND price_at_alert IS NOT NULL AND price_at_alert > 0
      AND max_gain_pct IS NOT NULL`,
).all() as Row[];

const STOP = 0.45, TRAIL = 0.35;
function ladderPnl(peak: number): number {
  let sold = 0, captured = 0;
  captured += 0.4 * 1.0; sold += 0.4;
  if (peak >= 2.0) { captured += 0.3 * 2.0; sold += 0.3; }
  if (peak >= 4.0) { captured += 0.2 * 4.0; sold += 0.2; }
  captured += (1 - sold) * peak * (1 - TRAIL);
  return captured;
}
function policyA(r: Row): number {
  const peak = (r.max_gain_pct ?? 0) / 100;
  const dd = (r.max_drawdown_pct ?? 0) / 100;
  const ret15 = r.price_15m != null && r.price_at_alert ? (r.price_15m - r.price_at_alert) / r.price_at_alert : 0;
  if (dd >= STOP) return -STOP;
  if (peak >= 1.0) return ladderPnl(peak);
  return ret15;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

for (const v of ["BUY_STRONG", "BUY_SMALL"]) {
  const rs = rows.filter((r) => r.verdict === v);
  const pnls = rs.map(policyA);
  console.log(`${v}: n=${rs.length}  ladder-realized mean PnL/trade = ${(mean(pnls) * 100).toFixed(2)}%  (stop-hit ${rs.filter(r => (r.max_drawdown_pct ?? 0) / 100 >= STOP).length})`);
}

// Capital-weighted expectancy: flat vs STRONG=2x SMALL. Hold total deployed constant.
const strong = rows.filter((r) => r.verdict === "BUY_STRONG").map(policyA);
const small = rows.filter((r) => r.verdict === "BUY_SMALL").map(policyA);
const nS = strong.length, nM = small.length;
const sumS = strong.reduce((a, b) => a + b, 0), sumM = small.reduce((a, b) => a + b, 0);

// FLAT: each trade weight 1. Portfolio return = total pnl / total capital.
const flatRet = (sumS + sumM) / (nS + nM);

// TIER-WEIGHTED: STRONG weight w=2, SMALL weight 1. Total capital = 2*nS + nM.
const w = 2;
const tierRet = (w * sumS + sumM) / (w * nS + nM);

console.log(`\nFlat-weighted portfolio return/unit:   ${(flatRet * 100).toFixed(3)}%`);
console.log(`Tier-weighted (STRONG ${w}x) return/unit: ${(tierRet * 100).toFixed(3)}%`);
console.log(`Delta (tier - flat): ${((tierRet - flatRet) * 100).toFixed(3)} pp`);

db.close();
