/**
 * WORKFLOW (READ-ONLY): Quantify realized-PnL impact of an
 *   "exit-if-red-at-15m" rule  vs  the CURRENT exit engine,
 * on traded BUYs that have BOTH a price_15m sample AND a resolved max_gain_pct.
 *
 *   npx tsx scripts/research/_wf_exitred15m_pnl.ts
 *
 * ---------------------------------------------------------------------------
 * MODEL ASSUMPTIONS (stated explicitly; all from recorded columns only)
 * ---------------------------------------------------------------------------
 * Units: per-trade return as a FRACTION of position (e.g. -0.45 = -45%).
 *        real_pnl_sol is NULL for every traded row in this DB, so we cannot use
 *        realized SOL PnL; we model fractional return per unit of capital, which
 *        is the apples-to-apples quantity the exit engine actually changes.
 *        WINNER therefore = max_gain_pct >= 100 (the real_pnl_sol>0 leg is moot).
 *
 * ret15m = (price_15m - price_at_alert)/price_at_alert.
 * peak   = max_gain_pct/100   (fractional peak gain over the whole window).
 * dd     = max_drawdown_pct/100 (magnitude of drawdown from peak, >=0).
 *
 * CURRENT EXIT ENGINE parameters (as deployed):
 *   profit ladder 40%@2x, 30%@3x, 20%@5x ; trailing stop 35% give-back active >=1.5x ;
 *   hard stop-loss -45% ; time-stop 4h.
 *
 * (A) CURRENT policy approximation  pnlA(token):
 *   1. STOP-LOSS FIRST: if dd >= 0.45  -> exit capped at -0.45.
 *        (faithful lower-bound: a 45%+ drawdown trips the hard stop; we assume the
 *         stop is the binding exit. This is the dominant loser outcome.)
 *   2. else if peak >= 1.00 (>=2x, hit a ladder rung) -> LADDERED capture.
 *        Ladder sells fractions at rungs and trails the remainder:
 *          - 40% of position sold at +100% (2x)
 *          - if peak>=2.00 (3x): +30% sold at +200%
 *          - if peak>=4.00 (5x): +20% sold at +400%
 *          - remaining fraction rides and exits via 35% trailing give-back from peak,
 *            i.e. remainder return = peak - 0.35*(1+peak) give-back ... we model the
 *            trailed remainder as exiting at  peak*(1-0.35)  (give back 35% of the
 *            peak multiple). Blend by the fractions actually sold at each rung.
 *   3. else (no rung, dd<0.45): exit "near final/trough" -> use ret15m if present
 *        else fall back to -dd (mild loser bounded by its own drawdown). For the
 *        common case these are small-gain/small-loss tokens that fizzle; ret15m is
 *        the best recorded proxy for where it actually went.
 *
 * (B) EARLY-EXIT policy  pnlB(token):
 *   if ret15m <= 0  -> exit at the 15m price: pnl = ret15m.
 *   else            -> identical to policy (A).
 *
 * We report mean PnL/trade under A vs B, sample size, and how many WINNERS
 * (max_gain_pct>=100) policy B cuts early (i.e. winners that were RED at 15m and
 * would be force-closed at a non-positive 15m return).
 *
 * SENSITIVITY: we also report a variant where step-(3) of policy A exits flat at
 * 0 instead of ret15m, to show the conclusion is not an artifact of that choice.
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), {
  readonly: true,
  fileMustExist: true,
});

type Row = {
  id: number;
  symbol: string | null;
  verdict: string;
  price_at_alert: number | null;
  price_15m: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
  real_pnl_sol: number | null;
};

// Universe: traded BUYs with a price_15m sample AND a resolved max_gain_pct AND a usable entry.
const rows = db
  .prepare(
    `SELECT id, symbol, verdict, price_at_alert, price_15m, max_gain_pct, max_drawdown_pct, real_pnl_sol
       FROM signals
      WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
        AND price_at_alert IS NOT NULL AND price_at_alert > 0
        AND price_15m IS NOT NULL
        AND max_gain_pct IS NOT NULL`,
  )
  .all() as Row[];

const STOP = 0.45; // hard stop-loss magnitude
const TRAIL = 0.35; // trailing give-back

function ladderPnl(peak: number): number {
  // peak is fractional peak gain (>=1.00 here). Fractions sold at rungs; remainder trails.
  let sold = 0;
  let captured = 0; // sum over sold fractions of (fraction * rungReturn)
  // rung 2x (+100%)
  const f2 = 0.4;
  captured += f2 * 1.0;
  sold += f2;
  if (peak >= 2.0) {
    const f3 = 0.3;
    captured += f3 * 2.0;
    sold += f3;
  }
  if (peak >= 4.0) {
    const f5 = 0.2;
    captured += f5 * 4.0;
    sold += f5;
  }
  // remainder rides; exits via 35% give-back from the peak multiple => return = peak*(1-TRAIL)
  const rem = 1 - sold;
  const remReturn = peak * (1 - TRAIL);
  captured += rem * remReturn;
  return captured;
}

function policyA(r: Row, tailUseRet15: boolean): number {
  const peak = (r.max_gain_pct ?? 0) / 100;
  const dd = (r.max_drawdown_pct ?? 0) / 100;
  const ret15 =
    r.price_15m != null && r.price_at_alert
      ? (r.price_15m - r.price_at_alert) / r.price_at_alert
      : 0;
  // 1. stop-loss binds
  if (dd >= STOP) return -STOP;
  // 2. hit a ladder rung
  if (peak >= 1.0) return ladderPnl(peak);
  // 3. fizzle: exit near final/trough
  if (tailUseRet15) return ret15;
  return 0; // sensitivity variant: flat exit
}

function policyB(r: Row, tailUseRet15: boolean): number {
  const ret15 =
    r.price_15m != null && r.price_at_alert
      ? (r.price_15m - r.price_at_alert) / r.price_at_alert
      : 0;
  if (ret15 <= 0) return ret15; // early exit at 15m
  return policyA(r, tailUseRet15);
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const n = rows.length;

// Verify scouting stats on this exact universe
const ret15Arr = rows.map((r) => (r.price_15m! - r.price_at_alert!) / r.price_at_alert!);
const up15 = ret15Arr.filter((x) => x > 0).length;
const winners = rows.filter((r) => (r.max_gain_pct ?? 0) >= 100);
const reds = rows.filter((r) => (r.price_15m! - r.price_at_alert!) / r.price_at_alert! <= 0);
const greens = rows.filter((r) => (r.price_15m! - r.price_at_alert!) / r.price_at_alert! > 0);
const redWinners = reds.filter((r) => (r.max_gain_pct ?? 0) >= 100);
const greenWinners = greens.filter((r) => (r.max_gain_pct ?? 0) >= 100);

// PnL under A and B (primary: tail uses ret15m; sensitivity: tail flat 0)
for (const tailUseRet15 of [true, false]) {
  const a = rows.map((r) => policyA(r, tailUseRet15));
  const b = rows.map((r) => policyB(r, tailUseRet15));
  const label = tailUseRet15 ? "PRIMARY (fizzle tail = ret15m)" : "SENSITIVITY (fizzle tail = 0)";
  console.log(`\n=== ${label} ===`);
  console.log(`n (traded w/ price_15m & max_gain): ${n}`);
  console.log(`mean PnL/trade  A(current): ${(mean(a) * 100).toFixed(2)}%   median ${(median(a) * 100).toFixed(2)}%`);
  console.log(`mean PnL/trade  B(early)  : ${(mean(b) * 100).toFixed(2)}%   median ${(median(b) * 100).toFixed(2)}%`);
  console.log(`delta B - A (mean): ${((mean(b) - mean(a)) * 100).toFixed(2)} pp/trade`);
  // winners cut early by B = winners that are RED@15m (force-closed at <=0)
  const winnersCut = winners.filter((r) => {
    const ret15 = (r.price_15m! - r.price_at_alert!) / r.price_at_alert!;
    return ret15 <= 0;
  });
  // PnL given up on those specific winners (A value minus B value)
  let giveUp = 0;
  for (const r of winnersCut) giveUp += policyA(r, tailUseRet15) - policyB(r, tailUseRet15);
  console.log(`WINNERS (max_gain>=100): ${winners.length}; of these RED@15m and cut early by B: ${winnersCut.length}`);
  console.log(`  PnL surrendered on cut winners (sum A-B over them): ${(giveUp * 100).toFixed(2)}%  -> per-trade drag over n: ${((giveUp / n) * 100).toFixed(2)} pp`);
}

// Descriptive verification of scouting finding on this universe
console.log(`\n=== SCOUTING VERIFICATION (this universe) ===`);
console.log(`mean ret@15m: ${(mean(ret15Arr) * 100).toFixed(2)}%   median ${(median(ret15Arr) * 100).toFixed(2)}%   up@15m: ${up15}/${n} (${((up15 / n) * 100).toFixed(1)}%)`);
console.log(`RED@15m count: ${reds.length}  -> mean peak gain ${(mean(reds.map((r) => r.max_gain_pct ?? 0))).toFixed(1)}%, winners(>=2x): ${redWinners.length}`);
console.log(`GREEN@15m count: ${greens.length} -> mean peak gain ${(mean(greens.map((r) => r.max_gain_pct ?? 0))).toFixed(1)}%, winners(>=2x): ${greenWinners.length}`);
console.log(`total winners(>=2x): ${winners.length}  (red:${redWinners.length} green:${greenWinners.length})`);
console.log(`real_pnl_sol non-null in universe: ${rows.filter((r) => r.real_pnl_sol != null).length} (WINNER reduces to max_gain>=100)`);

// List the red winners (the ones B would sacrifice) for inspection
if (redWinners.length) {
  console.log(`\n--- RED@15m winners that policy B would cut early ---`);
  for (const r of redWinners) {
    const ret15 = (r.price_15m! - r.price_at_alert!) / r.price_at_alert!;
    console.log(`  ${r.symbol ?? r.id}: ret15m=${(ret15 * 100).toFixed(1)}%  peak=${(r.max_gain_pct ?? 0).toFixed(0)}%  dd=${(r.max_drawdown_pct ?? 0).toFixed(0)}%`);
  }
}

db.close();
