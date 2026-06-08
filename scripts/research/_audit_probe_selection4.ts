/**
 * AUDIT PROBE 4 — selection-entry (READ-ONLY). drawdown sign + realizability.
 *   npx tsx scripts/research/_audit_probe_selection4.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
type Row = Record<string, unknown>;
const out: string[] = []; const p = (s = "") => out.push(s);
const mean = (a: number[]) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };

const buys = db.prepare(
  "SELECT scores, price_at_alert, price_5m, max_gain_pct, max_drawdown_pct FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
).all() as Row[];

const dd = buys.map((r) => num(r.max_drawdown_pct)).filter(Number.isFinite).sort((a, b) => a - b);
p(`max_drawdown_pct range: min=${dd[0]} max=${dd[dd.length - 1]}  mean=${mean(dd).toFixed(1)}  (sign check)`);
p(`  count < 0: ${dd.filter((x) => x < 0).length}   count > 0: ${dd.filter((x) => x > 0).length}`);

// Use absolute drawdown magnitude. Stop-loss fires at -45% => DD magnitude >= 45.
const absdd = (r: Row) => Math.abs(num(r.max_drawdown_pct));
const STOP = 45;
p(`\nREALIZABILITY: of the 2x-winners (max_gain>=100), how many first breached ${STOP}% drawdown?`);
for (const [name, f] of [["<70", (s: number) => s < 70], ["70-84", (s: number) => s >= 70 && s < 85], [">=85", (s: number) => s >= 85]] as [string, (s: number) => boolean][]) {
  const grp = buys.filter((r) => f(num(J(r.scores).momentum)));
  const win = grp.filter((r) => num(r.max_gain_pct) >= 100);
  const winBreached = win.filter((r) => absdd(r) >= STOP).length;
  p(`  momentum ${name.padEnd(6)} winners=${win.length}  breached ${STOP}%DD before spike: ${winBreached} (${win.length ? (100 * winBreached / win.length).toFixed(0) : "-"}%)  meanWinnerDD=${mean(win.map(absdd)).toFixed(0)}%`);
}
// All BUYs: fraction that breach the -45% stop at all
const allBreached = buys.filter((r) => absdd(r) >= STOP).length;
p(`\nALL traded BUYs breaching ${STOP}% drawdown (would hit hard stop): ${allBreached}/${buys.length} (${(100 * allBreached / buys.length).toFixed(0)}%)`);
const win2xAll = buys.filter((r) => num(r.max_gain_pct) >= 100);
const win2xBreached = win2xAll.filter((r) => absdd(r) >= STOP).length;
p(`ALL 2x-winners that ALSO breached ${STOP}% DD (spike unrealizable under -45% stop): ${win2xBreached}/${win2xAll.length} (${(100 * win2xBreached / win2xAll.length).toFixed(0)}%)`);

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
