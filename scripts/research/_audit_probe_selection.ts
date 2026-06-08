/**
 * AUDIT PROBE — selection-entry domain (READ-ONLY).
 * Quantifies: late-entry guard inertness, entry-into-pump fraction, the loser
 * tail (price_at_alert -> price_5m/15m), and whether filters reject winners /
 * admit losers.
 *   npx tsx scripts/research/_audit_probe_selection.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
type Row = Record<string, unknown>;
const out: string[] = []; const p = (s = "") => out.push(s);

function pctiles(vals: number[], ps: number[]): string {
  const v = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return "(none)";
  return ps.map((q) => {
    const idx = Math.min(v.length - 1, Math.floor((q / 100) * v.length));
    return `p${q}=${v[idx]!.toFixed(1)}`;
  }).join("  ");
}
function mean(vals: number[]): number {
  const v = vals.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

// ───────────────────────────────────────────────────────────────────────────
p("=".repeat(80));
p("SECTION 0 — universe sizes");
p("=".repeat(80));
const vd = db.prepare("SELECT verdict, COUNT(*) n FROM signals GROUP BY verdict ORDER BY n DESC").all() as Row[];
for (const r of vd) p(`  ${String(r.verdict).padEnd(12)} ${r.n}`);

const traded = db.prepare(
  "SELECT id, symbol, at, conviction, scores, price_at_alert, price_5m, price_15m, price_1h, max_gain_pct, max_drawdown_pct, exit_reason, hypothetical_pnl_sol FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')",
).all() as Row[];
p(`\n  traded BUYs total: ${traded.length}`);
const tradedPriced = traded.filter((r) => num(r.price_at_alert) > 0 && Number.isFinite(num(r.price_5m)));
p(`  traded w/ price_at_alert>0 AND price_5m: ${tradedPriced.length}`);

// ───────────────────────────────────────────────────────────────────────────
p("\n" + "=".repeat(80));
p("SECTION 1 — LATE-ENTRY GUARD INERTNESS (F-LATEGUARD confirm)");
p("=".repeat(80));
const lateRisk = traded.map((r) => num(J(r.scores).lateEntryRisk));
p(`  lateEntryRisk on traded BUYs: ${pctiles(lateRisk, [0, 25, 50, 75, 90, 99, 100])}  mean=${mean(lateRisk).toFixed(2)}`);
const nonzero = lateRisk.filter((x) => Number.isFinite(x) && x > 0).length;
p(`  traded BUYs with lateEntryRisk > 0: ${nonzero}/${lateRisk.filter(Number.isFinite).length}`);
// across ALL signals
const allLate = (db.prepare("SELECT scores FROM signals").all() as Row[]).map((r) => num(J(r.scores).lateEntryRisk));
const allNonzero = allLate.filter((x) => Number.isFinite(x) && x > 0).length;
p(`  ALL signals with lateEntryRisk > 0: ${allNonzero}/${allLate.filter(Number.isFinite).length}`);
// Was TOO_LATE ever a verdict?
const tooLate = db.prepare("SELECT COUNT(*) n FROM signals WHERE verdict='TOO_LATE'").get() as Row;
p(`  signals with verdict=TOO_LATE (guard fired): ${tooLate.n}`);

// ───────────────────────────────────────────────────────────────────────────
p("\n" + "=".repeat(80));
p("SECTION 2 — THE LOSER TAIL (entry-timing penalty): price_at_alert -> price_5m/15m");
p("=".repeat(80));
function ret(r: Row, h: string): number {
  const p0 = num(r.price_at_alert), p1 = num(r[h]);
  if (!(p0 > 0) || !(p1 > 0)) return NaN;
  return (p1 / p0 - 1) * 100;
}
for (const h of ["price_5m", "price_15m", "price_1h"]) {
  const rets = traded.map((r) => ret(r, h)).filter(Number.isFinite);
  if (!rets.length) { p(`  ${h}: (no data)`); continue; }
  const neg = rets.filter((x) => x < 0).length;
  const big = rets.filter((x) => x <= -20).length;
  p(`  ${h}: n=${rets.length} mean=${mean(rets).toFixed(1)}%  ${pctiles(rets, [1, 5, 10, 25, 50, 75, 90, 99])}`);
  p(`         immediately RED (<0): ${neg}/${rets.length} (${(100 * neg / rets.length).toFixed(1)}%)   <=-20%: ${big} (${(100 * big / rets.length).toFixed(1)}%)`);
}

// ───────────────────────────────────────────────────────────────────────────
p("\n" + "=".repeat(80));
p("SECTION 3 — ARE MOMENTUM/ORGANIC SCORERS REWARDING COINS THAT ALREADY RAN?");
p("=".repeat(80));
// Correlate the momentum/organic facet at decision time with the subsequent 5m return.
// If high momentum -> negative forward return, the scorer is buying tops.
function corr(xs: number[], ys: number[]): number {
  const pairs = xs.map((x, i) => [x, ys[i]!] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length < 5) return NaN;
  const mx = mean(pairs.map((q) => q[0])), my = mean(pairs.map((q) => q[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}
const mom = traded.map((r) => num(J(r.scores).momentum));
const org = traded.map((r) => num(J(r.scores).organic));
const fwd5 = traded.map((r) => ret(r, "price_5m"));
const fwd15 = traded.map((r) => ret(r, "price_15m"));
p(`  corr(momentum, fwd5m return) = ${corr(mom, fwd5).toFixed(3)}   corr(momentum, fwd15m) = ${corr(mom, fwd15).toFixed(3)}`);
p(`  corr(organic,  fwd5m return) = ${corr(org, fwd5).toFixed(3)}   corr(organic,  fwd15m) = ${corr(org, fwd15).toFixed(3)}`);
// bucket forward return by momentum band
function bandFwd(scoreVals: number[], fwd: number[], label: string) {
  const pairs = scoreVals.map((s, i) => [s, fwd[i]!] as const).filter(([s, f]) => Number.isFinite(s) && Number.isFinite(f));
  const bands: [string, (s: number) => boolean][] = [
    ["<50", (s) => s < 50], ["50-69", (s) => s >= 50 && s < 70], ["70-84", (s) => s >= 70 && s < 85], [">=85", (s) => s >= 85],
  ];
  p(`  forward 5m return by ${label} band:`);
  for (const [name, f] of bands) {
    const grp = pairs.filter(([s]) => f(s)).map(([, x]) => x);
    if (!grp.length) { p(`    ${name.padEnd(7)} n=0`); continue; }
    const neg = grp.filter((x) => x < 0).length;
    p(`    ${name.padEnd(7)} n=${grp.length} meanFwd=${mean(grp).toFixed(1)}% medianFwd=${pctiles(grp, [50])} red%=${(100 * neg / grp.length).toFixed(0)}`);
  }
}
bandFwd(mom, fwd5, "momentum");
bandFwd(org, fwd5, "organic");

// ───────────────────────────────────────────────────────────────────────────
p("\n" + "=".repeat(80));
p("SECTION 4 — DO FILTERS REJECT WINNERS / ADMIT LOSERS? (opportunity cost)");
p("=".repeat(80));
// Compare resolved outcome (max_gain_pct) across verdict classes.
const byV = db.prepare(
  "SELECT verdict, scores, max_gain_pct, max_drawdown_pct, conviction FROM signals WHERE max_gain_pct IS NOT NULL AND verdict IN ('BUY_SMALL','BUY_STRONG','WATCH_ONLY','WATCH','TOO_LATE','AVOID')",
).all() as Row[];
const isWin = (r: Row) => num(r.max_gain_pct) >= 100;
const isWin50 = (r: Row) => num(r.max_gain_pct) >= 50;
for (const v of ["BUY_STRONG", "BUY_SMALL", "WATCH_ONLY", "WATCH", "TOO_LATE", "AVOID"]) {
  const grp = byV.filter((r) => r.verdict === v);
  if (!grp.length) { p(`  ${v.padEnd(12)} n=0`); continue; }
  const w = grp.filter(isWin).length, w50 = grp.filter(isWin50).length;
  p(`  ${v.padEnd(12)} n=${grp.length}  win(>=2x)=${w} (${(100 * w / grp.length).toFixed(1)}%)  win(>=1.5x)=${w50} (${(100 * w50 / grp.length).toFixed(1)}%)  meanMaxGain=${mean(grp.map((r) => num(r.max_gain_pct))).toFixed(0)}%`);
}
// Winners that were NOT bought (rejected winners): WATCH/AVOID/TOO_LATE that hit >=2x
const rejWinners = byV.filter((r) => r.verdict !== "BUY_SMALL" && r.verdict !== "BUY_STRONG" && isWin(r));
p(`\n  REJECTED WINNERS (non-BUY that hit >=2x): ${rejWinners.length}`);
const tradedWinners = byV.filter((r) => (r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG") && isWin(r)).length;
p(`  TRADED WINNERS (BUY that hit >=2x): ${tradedWinners}`);

// ───────────────────────────────────────────────────────────────────────────
p("\n" + "=".repeat(80));
p("SECTION 5 — CONVICTION vs OUTCOME (is conviction predictive at all?)");
p("=".repeat(80));
const conv = tradedPriced.map((r) => num(r.conviction));
const gain = tradedPriced.map((r) => num(r.max_gain_pct));
p(`  corr(conviction, max_gain_pct) on traded = ${corr(tradedPriced.map((r) => num(r.conviction)), tradedPriced.map((r) => num(r.max_gain_pct))).toFixed(3)}`);
const convBands: [string, (c: number) => boolean][] = [
  ["55-59", (c) => c >= 55 && c < 60], ["60-71", (c) => c >= 60 && c < 72], [">=72(STRONG)", (c) => c >= 72],
];
for (const [name, f] of convBands) {
  const grp = traded.filter((r) => f(num(r.conviction)) && Number.isFinite(num(r.max_gain_pct)));
  if (!grp.length) { p(`  conviction ${name.padEnd(14)} n=0`); continue; }
  const w = grp.filter(isWin).length;
  p(`  conviction ${name.padEnd(14)} n=${grp.length} win(>=2x)=${(100 * w / grp.length).toFixed(1)}% meanMaxGain=${mean(grp.map((r) => num(r.max_gain_pct))).toFixed(0)}% meanDD=${mean(grp.map((r) => num(r.max_drawdown_pct))).toFixed(0)}%`);
}
void conv; void gain;

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
