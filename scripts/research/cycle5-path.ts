/**
 * Cycle 5 exit-timing analysis (READ-ONLY): the signals journal records actual
 * forward price samples (price_5m / price_15m / price_1h). Meme coins resolve
 * fast (avg paper hold ~18m) yet the time stop is 4h. Question: does early price
 * action predict the outcome, and would exiting earlier beat holding?
 *   tsx scripts/research/cycle5-path.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const n = (v: unknown) => (typeof v === "number" ? v : NaN);

const pop = db.prepare(
  "SELECT COUNT(*) total, COUNT(price_at_alert) pa, COUNT(price_5m) p5, COUNT(price_15m) p15, COUNT(price_1h) p1h FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')",
).get() as Record<string, number>;

const out: string[] = []; const p = (s = "") => out.push(s);
p(`# CYCLE 5 — EXIT-TIMING / PRICE-PATH (traded BUYs)`);
p(`population: ${JSON.stringify(pop)}`);

// Traded signals with an alert price AND at least one forward sample.
const rows = db.prepare(
  "SELECT price_at_alert pa, price_5m p5, price_15m p15, price_1h p1h, max_gain_pct mg, max_drawdown_pct dd " +
    "FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert IS NOT NULL",
).all() as Array<Record<string, unknown>>;

const ret = (pa: number, px: number) => (px - pa) / pa; // simple return vs entry
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const med = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

for (const [label, col] of [["5m", "p5"], ["15m", "p15"], ["1h", "p1h"]] as const) {
  const have = rows.filter((r) => Number.isFinite(n(r.pa)) && Number.isFinite(n(r[col])) && n(r.pa) > 0);
  const rets = have.map((r) => ret(n(r.pa), n(r[col])) * 100);
  const up = rets.filter((x) => x > 0).length;
  p("");
  p(`@${label} (n=${have.length}): mean ${mean(rets).toFixed(1)}%  median ${med(rets).toFixed(1)}%  up=${up}/${have.length} (${((up / (have.length || 1)) * 100).toFixed(0)}%)`);
}

// Does being DOWN at 15m predict a bad final outcome? Compare final maxGain for
// tokens green vs red at 15m.
const at15 = rows.filter((r) => Number.isFinite(n(r.p15)) && n(r.pa) > 0 && Number.isFinite(n(r.mg)));
const green15 = at15.filter((r) => ret(n(r.pa), n(r.p15)) > 0);
const red15 = at15.filter((r) => ret(n(r.pa), n(r.p15)) <= 0);
p("");
p(`predictive check (n=${at15.length} with 15m sample + outcome):`);
p(`  green @15m (${green15.length}): mean peak gain ${mean(green15.map((r) => n(r.mg))).toFixed(0)}%  reached>=100%: ${green15.filter((r) => n(r.mg) >= 100).length}`);
p(`  red   @15m (${red15.length}): mean peak gain ${mean(red15.map((r) => n(r.mg))).toFixed(0)}%  reached>=100%: ${red15.filter((r) => n(r.mg) >= 100).length}`);

// Exit-timing comparison: realized return if you SELL at each fixed horizon
// (proxy: the sampled price), vs the laddered hold (peak-based) lower bound.
p("");
p(`mean realized return by fixed-exit policy (sell the whole position at the horizon):`);
for (const [label, col] of [["5m", "p5"], ["15m", "p15"], ["1h", "p1h"]] as const) {
  const have = rows.filter((r) => Number.isFinite(n(r[col])) && n(r.pa) > 0);
  p(`  sell @${label}: ${(mean(have.map((r) => ret(n(r.pa), n(r[col])) * 100))).toFixed(1)}%  (n=${have.length})`);
}

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
