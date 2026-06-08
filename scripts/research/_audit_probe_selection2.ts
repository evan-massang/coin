/**
 * AUDIT PROBE 2 — selection-entry (READ-ONLY).
 * (a) phantom "buyer velocity declining sharply" reason on BUYs (seed-buffer artifact)
 * (b) dip-then-rip recovery vs true-loser split among red-at-5m BUYs
 * (c) realized hypothetical_pnl_sol + exit_reason by entry-timing
 * (d) organic adverse-selection: high coincident organic -> negative forward return
 *   npx tsx scripts/research/_audit_probe_selection2.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
const A = (v: unknown): string[] => { try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };
type Row = Record<string, unknown>;
const out: string[] = []; const p = (s = "") => out.push(s);
const mean = (a: number[]) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };
const sum = (a: number[]) => a.filter(Number.isFinite).reduce((x, y) => x + y, 0);

const buys = db.prepare(
  "SELECT id, symbol, conviction, scores, reasons, flags, price_at_alert, price_5m, price_15m, price_1h, max_gain_pct, max_drawdown_pct, exit_reason, hypothetical_pnl_sol FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')",
).all() as Row[];
const ret = (r: Row, h: string) => { const a = num(r.price_at_alert), b = num(r[h]); return (a > 0 && b > 0) ? (b / a - 1) * 100 : NaN; };

// ── (a) phantom decline reason ───────────────────────────────────────────────
p("=".repeat(80));
p("(a) PHANTOM 'buyer velocity declining sharply' on BUYs (seed-buffer artifact)");
p("=".repeat(80));
const phantom = buys.filter((r) => A(r.reasons).some((x) => /buyer velocity declining/i.test(x))).length;
p(`  BUYs whose reasons[] contain 'buyer velocity declining': ${phantom}/${buys.length} (${(100 * phantom / buys.length).toFixed(1)}%)`);
// lateEntryRisk == exactly 20 share (the phantom-only value)
const le = buys.map((r) => num(J(r.scores).lateEntryRisk));
const eq20 = le.filter((x) => x === 20).length, eq0 = le.filter((x) => x === 0).length, eq40 = le.filter((x) => x === 40).length;
p(`  lateEntryRisk exact values on BUYs:  ==0: ${eq0}   ==20: ${eq20}   ==40: ${eq40}   (max possible from empty buffer = 40 < 70 threshold)`);

// ── (b) dip-then-rip vs true loser ───────────────────────────────────────────
p("\n" + "=".repeat(80));
p("(b) RED@5m BUYs: dip-then-rip (recovered to >=2x) vs true loser");
p("=".repeat(80));
const resolved = buys.filter((r) => Number.isFinite(num(r.max_gain_pct)) && num(r.price_at_alert) > 0 && Number.isFinite(num(r.price_5m)));
const red5 = resolved.filter((r) => ret(r, "price_5m") < 0);
const red5_recovered = red5.filter((r) => num(r.max_gain_pct) >= 100).length;
const red5_recov50 = red5.filter((r) => num(r.max_gain_pct) >= 50).length;
const green5 = resolved.filter((r) => ret(r, "price_5m") >= 0);
const green5_win = green5.filter((r) => num(r.max_gain_pct) >= 100).length;
p(`  resolved BUYs (price+gain): ${resolved.length}`);
p(`  RED@5m: ${red5.length}  -> later reached >=2x: ${red5_recovered} (${(100 * red5_recovered / Math.max(1, red5.length)).toFixed(1)}%)   >=1.5x: ${red5_recov50} (${(100 * red5_recov50 / Math.max(1, red5.length)).toFixed(1)}%)`);
p(`  GREEN@5m: ${green5.length} -> later reached >=2x: ${green5_win} (${(100 * green5_win / Math.max(1, green5.length)).toFixed(1)}%)`);
// deep red (<=-50% at 5m): do these ever recover?
const deepRed = resolved.filter((r) => ret(r, "price_5m") <= -50);
const deepRecov = deepRed.filter((r) => num(r.max_gain_pct) >= 100).length;
p(`  DEEP RED (<=-50%@5m): ${deepRed.length}  -> later reached >=2x: ${deepRecov} (${(100 * deepRecov / Math.max(1, deepRed.length)).toFixed(1)}%)  meanMaxGain=${mean(deepRed.map((r) => num(r.max_gain_pct))).toFixed(0)}%`);

// ── (c) realized PnL + exit reasons by entry-timing bucket ───────────────────
p("\n" + "=".repeat(80));
p("(c) realized hypothetical_pnl_sol by 5m entry-timing bucket");
p("=".repeat(80));
const withPnl = buys.filter((r) => Number.isFinite(num(r.hypothetical_pnl_sol)) && num(r.price_at_alert) > 0 && Number.isFinite(num(r.price_5m)));
p(`  BUYs with hypothetical_pnl_sol: ${withPnl.length}  total pnl = ${sum(withPnl.map((r) => num(r.hypothetical_pnl_sol))).toFixed(3)} SOL`);
const buckets: [string, (x: number) => boolean][] = [
  ["<=-50%@5m", (x) => x <= -50], ["-50..-20", (x) => x > -50 && x <= -20], ["-20..0", (x) => x > -20 && x < 0], ["0..+20", (x) => x >= 0 && x < 20], [">=+20%", (x) => x >= 20],
];
for (const [name, f] of buckets) {
  const grp = withPnl.filter((r) => f(ret(r, "price_5m")));
  if (!grp.length) { p(`  ${name.padEnd(12)} n=0`); continue; }
  const tot = sum(grp.map((r) => num(r.hypothetical_pnl_sol)));
  p(`  ${name.padEnd(12)} n=${String(grp.length).padStart(3)}  totalPnL=${tot.toFixed(3)} SOL  avgPnL=${(tot / grp.length).toFixed(4)}  share=${(100 * grp.length / withPnl.length).toFixed(0)}%`);
}
p("\n  exit_reason distribution on traded BUYs:");
const exits = new Map<string, number>();
for (const r of buys) { const e = String(r.exit_reason ?? "(null)"); exits.set(e, (exits.get(e) ?? 0) + 1); }
for (const [e, n] of [...exits.entries()].sort((a, b) => b[1] - a[1])) p(`    ${e.padEnd(22)} ${n}`);

// ── (d) organic adverse selection ────────────────────────────────────────────
p("\n" + "=".repeat(80));
p("(d) ORGANIC adverse-selection: coincident 5m buy-share -> forward 5m return");
p("=".repeat(80));
const org = resolved.map((r) => num(J(r.scores).organic));
const f5 = resolved.map((r) => ret(r, "price_5m"));
const oband: [string, (s: number) => boolean][] = [["30-49", (s) => s >= 30 && s < 50], ["50-69", (s) => s >= 50 && s < 70], ["70-84", (s) => s >= 70 && s < 85], [">=85", (s) => s >= 85]];
for (const [name, f] of oband) {
  const idx = org.map((s, i) => [s, f5[i]!] as const).filter(([s, r]) => f(s) && Number.isFinite(r));
  if (!idx.length) { p(`  organic ${name.padEnd(7)} n=0`); continue; }
  const vals = idx.map(([, r]) => r);
  const red = vals.filter((x) => x < 0).length;
  // recovery to 2x within this band
  const recIdx = resolved.filter((r) => f(num(J(r.scores).organic)));
  const rec = recIdx.filter((r) => num(r.max_gain_pct) >= 100).length;
  p(`  organic ${name.padEnd(7)} n=${String(vals.length).padStart(3)}  meanFwd5m=${mean(vals).toFixed(1)}%  red%=${(100 * red / vals.length).toFixed(0)}  later>=2x=${(100 * rec / Math.max(1, recIdx.length)).toFixed(1)}%`);
}

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
