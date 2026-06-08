/**
 * AUDIT PROBE 3 — selection-entry (READ-ONLY).
 * (e) realized SOL from paper_positions/paper_trades (ground truth)
 * (f) is the momentum>=85 "edge" realizable? max_gain vs drawdown vs red@5m
 * (g) combined entry filter sim: would skipping high-organic/red-prone BUYs help?
 *   npx tsx scripts/research/_audit_probe_selection3.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
type Row = Record<string, unknown>;
const out: string[] = []; const p = (s = "") => out.push(s);
const mean = (a: number[]) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };
const sum = (a: number[]) => a.filter(Number.isFinite).reduce((x, y) => x + y, 0);

// ── (e) realized SOL ground truth ────────────────────────────────────────────
p("=".repeat(80));
p("(e) REALIZED SOL — paper tables (ground truth)");
p("=".repeat(80));
try {
  const pos = db.prepare("SELECT COUNT(*) n, SUM(realized_pnl_usd) tot FROM paper_positions").get() as Row;
  p(`  paper_positions: n=${pos.n}  sum(realized_pnl_usd)=${num(pos.tot).toFixed(2)}`);
  const closed = db.prepare("SELECT COUNT(*) n FROM paper_positions WHERE closed_at_ms IS NOT NULL").get() as Row;
  p(`  closed positions: ${closed.n}`);
  const tr = db.prepare("SELECT side, COUNT(*) n, SUM(realized_pnl_sol) tot FROM paper_trades GROUP BY side").all() as Row[];
  for (const r of tr) p(`  paper_trades ${String(r.side).padEnd(6)} n=${r.n}  sum(realized_pnl_sol)=${num(r.tot).toFixed(4)}`);
  const totPnl = db.prepare("SELECT SUM(realized_pnl_sol) tot FROM paper_trades").get() as Row;
  p(`  TOTAL realized_pnl_sol across paper_trades: ${num(totPnl.tot).toFixed(4)} SOL`);
} catch (e) { p(`  (paper tables error: ${String(e)})`); }

// ── (f) momentum>=85 realizability ───────────────────────────────────────────
p("\n" + "=".repeat(80));
p("(f) IS THE momentum>=85 EDGE REALIZABLE? max_gain vs drawdown vs red@5m");
p("=".repeat(80));
const buys = db.prepare(
  "SELECT scores, price_at_alert, price_5m, max_gain_pct, max_drawdown_pct, conviction FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
).all() as Row[];
const ret5 = (r: Row) => { const a = num(r.price_at_alert), b = num(r.price_5m); return (a > 0 && b > 0) ? (b / a - 1) * 100 : NaN; };
const mband: [string, (s: number) => boolean][] = [["<70", (s) => s < 70], ["70-84", (s) => s >= 70 && s < 85], [">=85", (s) => s >= 85]];
p("  (max_drawdown_pct = worst dip ever; stop-loss is -45%, so DD>=45 => likely stopped out before any spike)");
for (const [name, f] of mband) {
  const grp = buys.filter((r) => f(num(J(r.scores).momentum)));
  if (!grp.length) { p(`  momentum ${name.padEnd(7)} n=0`); continue; }
  const win2x = grp.filter((r) => num(r.max_gain_pct) >= 100).length;
  const dd = grp.map((r) => num(r.max_drawdown_pct));
  const stoppedBeforeSpike = grp.filter((r) => num(r.max_drawdown_pct) <= -45 && num(r.max_gain_pct) >= 100).length;
  const r5 = grp.map(ret5).filter(Number.isFinite);
  p(`  momentum ${name.padEnd(7)} n=${String(grp.length).padStart(3)}  max2x=${(100 * win2x / grp.length).toFixed(1)}%  meanMaxGain=${mean(grp.map((r) => num(r.max_gain_pct))).toFixed(0)}%  meanMaxDD=${mean(dd).toFixed(0)}%  medianFwd5m=${r5.length ? r5.sort((a, b) => a - b)[Math.floor(r5.length / 2)]!.toFixed(0) : "-"}%`);
  p(`            of the 2x-winners, ${stoppedBeforeSpike}/${win2x} also hit <=-45% DD (would trip the -45% stop FIRST => spike unrealizable)`);
}

// ── (g) combined entry filter simulation ─────────────────────────────────────
p("\n" + "=".repeat(80));
p("(g) ENTRY-FILTER SIM: keep only BUYs with organic<70 (avoid coincident-pump tops)");
p("=".repeat(80));
const resolved = buys.filter((r) => num(r.price_at_alert) > 0 && Number.isFinite(num(r.price_5m)));
function summarize(label: string, set: Row[]) {
  if (!set.length) { p(`  ${label}: n=0`); return; }
  const win2x = set.filter((r) => num(r.max_gain_pct) >= 100).length;
  const win15 = set.filter((r) => num(r.max_gain_pct) >= 50).length;
  const red = set.filter((r) => ret5(r) < 0).length;
  p(`  ${label.padEnd(30)} n=${String(set.length).padStart(3)}  win2x=${(100 * win2x / set.length).toFixed(1)}%  win1.5x=${(100 * win15 / set.length).toFixed(1)}%  red@5m=${(100 * red / set.length).toFixed(0)}%  meanMaxGain=${mean(set.map((r) => num(r.max_gain_pct))).toFixed(0)}%`);
}
summarize("ALL traded BUYs (baseline)", resolved);
summarize("organic<70 only", resolved.filter((r) => num(J(r.scores).organic) < 70));
summarize("organic<85 only", resolved.filter((r) => num(J(r.scores).organic) < 85));
summarize("organic>=85 (the cohort dropped)", resolved.filter((r) => num(J(r.scores).organic) >= 85));
summarize("organic 45-69 sweet spot", resolved.filter((r) => { const o = num(J(r.scores).organic); return o >= 45 && o < 70; }));

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
