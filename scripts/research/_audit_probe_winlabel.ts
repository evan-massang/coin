/** READ-ONLY adversarial probe of the "win metric is unrealizable / 100% breach -45% stop" finding. */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const out: string[] = []; const p = (s = "") => out.push(s);

// ── 1. Reproduce the co-occurrence claim: 2x-winners that ALSO have maxDD>=45 ──
type Row = Record<string, unknown>;
const buys = db.prepare(
  "SELECT mint, scores, max_gain_pct g, max_drawdown_pct d FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
).all() as Row[];
const winners = buys.filter((r) => num(r.g) >= 100);
const winDDge45 = winners.filter((r) => num(r.d) >= 45);
p(`traded BUYs=${buys.length}  2x-winners(maxGain>=100)=${winners.length}`);
p(`  winners with max_drawdown_pct>=45 (FROM PEAK): ${winDDge45.length}/${winners.length}`);
const allDDge45 = buys.filter((r) => num(r.d) >= 45);
p(`  ALL BUYs with max_drawdown_pct>=45: ${allDDge45.length}/${buys.length} (${(100*allDDge45.length/buys.length).toFixed(0)}%)`);

// ── 2. KEY: max_drawdown_pct is FROM PEAK. The -45% hard stop is FROM ENTRY.   ──
//    Convert: for a winner, from-entry trough = peak*(1-dd). Compute implied
//    from-entry low and ask: would the -45%-from-ENTRY stop actually have fired?
//    from-entry-low% = (1+maxGain/100)*(1-maxDD/100) - 1
let wouldFireFromEntry = 0;
for (const r of winners) {
  const peakMult = 1 + num(r.g) / 100;            // peak / entry
  const lowMult = peakMult * (1 - num(r.d) / 100); // trough / entry
  if (lowMult <= 0.55) wouldFireFromEntry++;       // -45% from entry
}
p(`\n  winners whose IMPLIED from-entry low <= -45% (stop COULD fire): ${wouldFireFromEntry}/${winners.length}`);
p(`  (note: even these don't prove the dip came BEFORE the 2x peak — magnitude only)`);

// ── 3. Path-aware truth from paper_price_samples (pnl_pct is FROM ENTRY, time-ordered) ──
const pos = db.prepare("SELECT id, mint FROM paper_positions").all() as Row[];
let reached2x = 0, dipBefore2x = 0, dipAfterOrNever = 0, neverDipped = 0;
const detail: string[] = [];
for (const ps of pos) {
  const s = db.prepare("SELECT at, pnl_pct FROM paper_price_samples WHERE position_id=? ORDER BY at ASC").all(ps.id) as Row[];
  if (!s.length) continue;
  let firstStopIdx = -1, first2xIdx = -1;
  s.forEach((x, i) => {
    const v = num(x.pnl_pct);
    if (firstStopIdx < 0 && v <= -45) firstStopIdx = i;
    if (first2xIdx < 0 && v >= 100) first2xIdx = i;
  });
  if (first2xIdx >= 0) {
    reached2x++;
    if (firstStopIdx >= 0 && firstStopIdx < first2xIdx) dipBefore2x++;
    else if (firstStopIdx >= 0) dipAfterOrNever++;
    else neverDipped++;
    const maxv = Math.max(...s.map((x) => num(x.pnl_pct)));
    detail.push(`    pos ${ps.id} ${String(ps.mint).slice(0,6)}: reached2x@idx${first2xIdx} stop@idx${firstStopIdx} maxPnl=${maxv.toFixed(0)}% samples=${s.length}`);
  }
}
p(`\n  PAPER positions w/ samples reaching +100% from entry: ${reached2x}`);
p(`    of those, dipped <=-45% from entry BEFORE the +100%: ${dipBefore2x}`);
p(`    dipped <=-45% only AFTER +100% (give-back): ${dipAfterOrNever}`);
p(`    never dipped <=-45% from entry at all: ${neverDipped}`);
detail.forEach((d) => p(d));

// ── 4. Ground truth: what did the REAL paper exit engine actually realize? ──
const trades = db.prepare("SELECT mint, SUM(realized_pnl_sol) pnl, COUNT(*) n FROM paper_trades WHERE realized_pnl_sol IS NOT NULL GROUP BY mint").all() as Row[];
let posPnl = 0, negPnl = 0, totPnl = 0;
for (const t of trades) { const v = num(t.pnl); if (!Number.isFinite(v)) continue; totPnl += v; if (v > 0) posPnl++; else if (v < 0) negPnl++; }
p(`\n  paper_trades realized: mints=${trades.length} positivePnl=${posPnl} negPnl=${negPnl} totalRealized=${totPnl.toFixed(4)} SOL`);

// ── 5. Cross-check: do any max_gain>=100 winners overlap paper positions & realize >0? ──
const winnerMints = new Set(winners.map((r) => String(r.mint)));
let winnerRealizedPos = 0, winnerRealizedNeg = 0;
for (const t of trades) { if (winnerMints.has(String(t.mint))) { const v = num(t.pnl); if (v>0) winnerRealizedPos++; else if (v<0) winnerRealizedNeg++; } }
p(`  of max_gain>=100 winner mints that were paper-traded: realized>0=${winnerRealizedPos} realized<0=${winnerRealizedNeg}`);

console.log(out.join("\n"));
db.close();
