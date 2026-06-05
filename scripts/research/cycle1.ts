/**
 * Research Director — Cycle 1 quant analysis. READ-ONLY over the live DB.
 * Confidence calibration, evidence quality, failure/missed-opportunity scan,
 * council accuracy, data sufficiency. Prints a structured report; changes nothing.
 *   tsx scripts/research/cycle1.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.resolve("data/sniper.sqlite");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };

interface Row { verdict: string; conviction: number; scores: string; max_gain_pct: number | null; max_drawdown_pct: number | null; real_pnl_sol: number | null; symbol: string | null; mint: string; }

const out: string[] = [];
const p = (s = "") => out.push(s);

// ── counts + data sufficiency (Domain 10) ──
const total = num((db.prepare("SELECT COUNT(*) n FROM signals").get() as { n: number }).n);
const resolvedN = num((db.prepare("SELECT COUNT(*) n FROM signals WHERE max_gain_pct IS NOT NULL").get() as { n: number }).n);
const byVerdict = db.prepare("SELECT verdict, COUNT(*) n, SUM(CASE WHEN max_gain_pct IS NOT NULL THEN 1 ELSE 0 END) res FROM signals GROUP BY verdict ORDER BY n DESC").all() as Array<{ verdict: string; n: number; res: number }>;
const hasRegime = (db.prepare("SELECT COUNT(*) n FROM pragma_table_info('signals') WHERE name='regime'").get() as { n: number }).n > 0;

p("# RESEARCH CYCLE 1 — QUANT ANALYSIS");
p(`signals total=${total} · resolved(price path)=${resolvedN} (${pct(resolvedN, total)}%)`);
p("by verdict: " + byVerdict.map((v) => `${v.verdict}=${v.n}(res ${v.res})`).join("  "));
p(`regime persisted per signal: ${hasRegime ? "yes" : "NO (cannot analyze per-regime历史)"}`);

const rows = db.prepare("SELECT verdict, conviction, scores, max_gain_pct, max_drawdown_pct, real_pnl_sol, symbol, mint FROM signals WHERE max_gain_pct IS NOT NULL").all() as Row[];
const isWin = (r: Row) => num(r.max_gain_pct) >= 100 || num(r.real_pnl_sol) > 0;
const isBuy = (r: Row) => r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG";

// ── Domain 5: confidence calibration ──
p("\n## Domain 5 — Confidence calibration (is conviction predictive?)");
const bins = [[0, 50], [50, 60], [60, 70], [70, 85], [85, 101]];
const calib = (set: Row[], label: string) => {
  p(`  ${label} (n=${set.length}):`);
  if (!set.length) { p("    (no data)"); return; }
  for (const [lo, hi] of bins) {
    const b = set.filter((r) => num(r.conviction) >= lo && num(r.conviction) < hi);
    if (!b.length) continue;
    const wins = b.filter(isWin).length;
    const avgGain = Math.round(b.reduce((a, r) => a + num(r.max_gain_pct), 0) / b.length);
    p(`    conv ${lo}-${hi}: n=${b.length}  win%=${pct(wins, b.length)}  avgMaxGain=${avgGain}%`);
  }
};
calib(rows, "all resolved");
calib(rows.filter(isBuy), "BUY only");

// ── Domain 6: evidence quality (winner vs loser facet averages) ──
p("\n## Domain 6 — Evidence quality (winner vs loser avg score; lift = winner−loser)");
const facets = ["safety", "organic", "momentum", "graduation", "devReputation", "smartMoney", "social", "hype", "lateEntryRisk"];
const winners = rows.filter(isWin), losers = rows.filter((r) => !isWin(r));
const avgFacet = (set: Row[], f: string) => set.length ? set.reduce((a, r) => a + num(J(r.scores)[f]), 0) / set.length : 0;
if (winners.length >= 3 && losers.length >= 3) {
  const lifts = facets.map((f) => ({ f, w: avgFacet(winners, f), l: avgFacet(losers, f) })).map((x) => ({ ...x, lift: x.w - x.l }));
  lifts.sort((a, b) => b.lift - a.lift);
  p(`  winners=${winners.length} losers=${losers.length}`);
  for (const x of lifts) p(`    ${x.f.padEnd(14)} winner=${x.w.toFixed(1).padStart(5)} loser=${x.l.toFixed(1).padStart(5)} lift=${(x.lift >= 0 ? "+" : "") + x.lift.toFixed(1)}`);
} else p(`  insufficient resolved signals (winners=${winners.length} losers=${losers.length}) — need >=3 each`);

// ── Domain 3: failure analysis (worst losing buys) ──
p("\n## Domain 3 — Failure analysis (worst resolved BUYs)");
const buyLosers = rows.filter(isBuy).filter((r) => !isWin(r)).sort((a, b) => num(b.max_drawdown_pct) - num(a.max_drawdown_pct)).slice(0, 8);
if (buyLosers.length) for (const r of buyLosers) { const s = J(r.scores); p(`    $${r.symbol ?? r.mint.slice(0, 5)} conv=${r.conviction} maxGain=${num(r.max_gain_pct).toFixed(0)}% dd=${num(r.max_drawdown_pct).toFixed(0)}% org=${num(s.organic)} mom=${num(s.momentum)} smart=${num(s.smartMoney)} late=${num(s.lateEntryRisk)}`); }
else p("    (no resolved losing BUYs)");

// ── Domain 4: missed opportunities (rejected/WATCH that pumped) ──
p("\n## Domain 4 — Missed opportunities (non-BUY that later ran ≥100%)");
const missed = rows.filter((r) => !isBuy(r) && num(r.max_gain_pct) >= 100).sort((a, b) => num(b.max_gain_pct) - num(a.max_gain_pct)).slice(0, 8);
if (missed.length) for (const r of missed) { const s = J(r.scores); p(`    $${r.symbol ?? r.mint.slice(0, 5)} verdict=${r.verdict} conv=${r.conviction} maxGain=${num(r.max_gain_pct).toFixed(0)}% org=${num(s.organic)} late=${num(s.lateEntryRisk)} safety=${num(s.safety)}`); }
else p("    (none — note: AVOID signals are not price-tracked, so this only covers WATCH_ONLY)");

// ── Domain 7: council accuracy ──
p("\n## Domain 7 — Council accuracy");
const hasCouncil = (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='council_opinions'").get() as { n: number }).n > 0;
if (hasCouncil) {
  const cn = num((db.prepare("SELECT COUNT(*) n FROM council_opinions").get() as { n: number }).n);
  const cres = num((db.prepare("SELECT COUNT(*) n FROM council_opinions WHERE outcome IS NOT NULL").get() as { n: number }).n);
  p(`  opinions=${cn} resolved=${cres}`);
  const seats = db.prepare(`SELECT member_id, label, COUNT(*) total, SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) resolved,
      SUM(CASE WHEN (recommendation='confirm' AND outcome='win') OR (recommendation='caution' AND outcome='loss') THEN 1 ELSE 0 END) correct
      FROM council_opinions GROUP BY member_id`).all() as Array<{ member_id: string; label: string; total: number; resolved: number; correct: number }>;
  for (const s of seats) p(`    ${(s.label ?? s.member_id).padEnd(14)} total=${s.total} resolved=${s.resolved} accuracy=${s.resolved ? pct(s.correct, s.resolved) : "n/a"}%`);
} else p("  (no council_opinions table)");

p("\n## summary");
p(`  resolved BUYs=${rows.filter(isBuy).length} · winners=${winners.length} · enough-for-stats=${winners.length >= 10 && losers.length >= 10 ? "YES" : "NO — findings are directional only"}`);

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
