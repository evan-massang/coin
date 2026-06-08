import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const q = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as Record<string, unknown>[];
const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as Record<string, unknown>;
const L = (s: string) => console.log(s);

L("===== SIGNALS: outcome-column coverage =====");
const sig = one("SELECT COUNT(*) n FROM signals");
L(`signals total: ${sig.n}`);
const byV = q("SELECT verdict, COUNT(*) n FROM signals GROUP BY verdict ORDER BY n DESC");
for (const r of byV) L(`  ${r.verdict}: ${r.n}`);
const cov = one(`SELECT
  SUM(max_gain_pct IS NOT NULL) gain,
  SUM(max_drawdown_pct IS NOT NULL) draw,
  SUM(price_5m IS NOT NULL) p5,
  SUM(price_15m IS NOT NULL) p15,
  SUM(price_1h IS NOT NULL) p1h,
  SUM(real_pnl_sol IS NOT NULL) realpnl,
  SUM(hypothetical_pnl_sol IS NOT NULL) hyppnl,
  SUM(exit_reason IS NOT NULL) exitr
FROM signals`);
L(`coverage: max_gain=${cov.gain} max_draw=${cov.draw} p5m=${cov.p5} p15m=${cov.p15} p1h=${cov.p1h} real_pnl=${cov.realpnl} hyp_pnl=${cov.hyppnl} exit_reason=${cov.exitr}`);

L("\n===== BUY signals only =====");
const buy = one("SELECT COUNT(*) n, SUM(max_gain_pct IS NOT NULL) resolved, SUM(real_pnl_sol IS NOT NULL) realpnl, SUM(price_5m IS NOT NULL) p5, SUM(price_15m IS NOT NULL) p15, SUM(price_1h IS NOT NULL) p1h FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')");
L(`BUY total=${buy.n} resolved(max_gain)=${buy.resolved} real_pnl=${buy.realpnl} p5m=${buy.p5} p15m=${buy.p15} p1h=${buy.p1h}`);

L("\n===== price_5m == price_15m (the 'same forwarded price' fiction check) =====");
const samep = one("SELECT COUNT(*) n FROM signals WHERE price_5m IS NOT NULL AND price_15m IS NOT NULL AND price_5m = price_15m");
const bothp = one("SELECT COUNT(*) n FROM signals WHERE price_5m IS NOT NULL AND price_15m IS NOT NULL");
L(`rows w/ both p5m & p15m: ${bothp.n}; of those identical: ${samep.n}`);

L("\n===== TIME WINDOW / regime sample sizes (BUY resolved) =====");
const span = one("SELECT MIN(at) mn, MAX(at) mx, COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL");
if (span.mn) {
  const hrs = ((span.mx as number) - (span.mn as number)) / 3_600_000;
  L(`resolved BUYs: ${span.n} over ${hrs.toFixed(1)}h  (min=${new Date(span.mn as number).toISOString()} max=${new Date(span.mx as number).toISOString()})`);
}
const allspan = one("SELECT MIN(at) mn, MAX(at) mx FROM signals");
L(`full signals table spans: ${new Date(allspan.mn as number).toISOString()} .. ${new Date(allspan.mx as number).toISOString()}`);
// per-day BUY resolved counts
const perday = q(`SELECT date(at/1000,'unixepoch') d, COUNT(*) n, SUM(max_gain_pct IS NOT NULL) resolved
  FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') GROUP BY d ORDER BY d`);
L("per-day BUY counts (resolved = has max_gain):");
for (const r of perday) L(`  ${r.d}: buys=${r.n} resolved=${r.resolved}`);

L("\n===== WIN distribution (BUY resolved) — sample-size sanity =====");
const wins = one("SELECT COUNT(*) n, SUM(max_gain_pct>=100) w2x, SUM(max_gain_pct>=200) w3x, SUM(max_gain_pct>=400) w5x, AVG(max_gain_pct) avgGain, AVG(max_drawdown_pct) avgDraw FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL");
L(`resolved BUYs=${wins.n}: >=2x=${wins.w2x} >=3x=${wins.w3x} >=5x=${wins.w5x}  avgMaxGain=${(wins.avgGain as number)?.toFixed(1)}% avgMaxDraw=${(wins.avgDraw as number)?.toFixed(1)}%`);

L("\n===== PAPER TRADES (the only place realized PnL lives) =====");
const pt = one("SELECT COUNT(*) n, SUM(side='buy') buys, SUM(side='sell') sells FROM paper_trades");
L(`paper_trades: total=${pt.n} buys=${pt.buys} sells=${pt.sells}`);
const ptpnl = one("SELECT SUM(realized_pnl_sol) tot, AVG(realized_pnl_sol) avg, MIN(realized_pnl_sol) mn, MAX(realized_pnl_sol) mx, SUM(realized_pnl_sol>0) wins, COUNT(*) n FROM paper_trades WHERE side='sell'");
L(`sells realized_pnl_sol: total=${(ptpnl.tot as number)?.toFixed(4)} avg=${(ptpnl.avg as number)?.toFixed(4)} min=${(ptpnl.mn as number)?.toFixed(4)} max=${(ptpnl.mx as number)?.toFixed(4)} wins=${ptpnl.wins}/${ptpnl.n}`);
const ptspan = one("SELECT MIN(at) mn, MAX(at) mx FROM paper_trades");
if (ptspan.mn) L(`paper_trades span: ${new Date(ptspan.mn as number).toISOString()} .. ${new Date(ptspan.mx as number).toISOString()}`);

L("\n===== PAPER POSITIONS =====");
const pp = one("SELECT COUNT(*) n, SUM(closed_at_ms IS NOT NULL) closed, SUM(closed_at_ms IS NULL) open FROM paper_positions");
L(`paper_positions: total=${pp.n} closed=${pp.closed} open=${pp.open}`);
const pppnl = one("SELECT SUM(realized_pnl_usd) totUsd, AVG(realized_pnl_usd) avgUsd FROM paper_positions WHERE closed_at_ms IS NOT NULL");
L(`closed positions realized_pnl_usd: total=${(pppnl.totUsd as number)?.toFixed(2)} avg=${(pppnl.avgUsd as number)?.toFixed(2)}`);

L("\n===== JOIN FEASIBILITY: paper positions <-> signals on mint =====");
const distinctPosMints = one("SELECT COUNT(DISTINCT mint) n FROM paper_positions");
const distinctBuyMints = one("SELECT COUNT(DISTINCT mint) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')");
L(`distinct mints: paper_positions=${distinctPosMints.n}  BUY signals=${distinctBuyMints.n}`);
const overlap = one("SELECT COUNT(DISTINCT pp.mint) n FROM paper_positions pp JOIN signals s ON s.mint=pp.mint AND s.verdict IN ('BUY_SMALL','BUY_STRONG')");
L(`paper-position mints that have >=1 BUY signal: ${overlap.n}`);
// mints with MULTIPLE buy signals (ambiguous join — which signal triggered the trade?)
const multi = one("SELECT COUNT(*) n FROM (SELECT mint, COUNT(*) c FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') GROUP BY mint HAVING c>1)");
L(`mints with >1 BUY signal (ambiguous mint-join): ${multi.n}`);

L("\n===== LEARNING_FEATURES (what analyzePerformance learns from) =====");
const lf = one("SELECT COUNT(*) n FROM learning_features");
L(`learning_features total: ${lf.n}`);
const lfsrc = q("SELECT source, COUNT(*) n FROM learning_features GROUP BY source");
for (const r of lfsrc) L(`  source=${r.source}: ${r.n}`);
const lfcov = one("SELECT SUM(realized_pnl_sol IS NOT NULL) realpnl, SUM(max_gain_pct IS NOT NULL) gain, SUM(exit_price_usd IS NOT NULL) exitp, SUM(exit_reason IS NOT NULL) exitr FROM learning_features");
L(`learning_features coverage: realized_pnl=${lfcov.realpnl} max_gain=${lfcov.gain} exit_price=${lfcov.exitp} exit_reason=${lfcov.exitr}`);
const lfbuy = one("SELECT COUNT(*) n FROM learning_features WHERE verdict IN ('BUY_SMALL','BUY_STRONG')");
L(`learning_features BUY rows (analyzePerformance needs >=12): ${lfbuy.n}`);
const lfspan = one("SELECT MIN(at) mn, MAX(at) mx FROM learning_features");
if (lfspan.mn) L(`learning_features span: ${new Date(lfspan.mn as number).toISOString()} .. ${new Date(lfspan.mx as number).toISOString()}`);

L("\n===== SUGGESTIONS / AUTO-TUNE / BACKTESTS / REPLAY =====");
for (const t of ["learning_suggestions", "backtest_runs", "replay_events", "setting_change_log"]) {
  try {
    const r = one(`SELECT COUNT(*) n FROM ${t}`);
    L(`  ${t}: ${r.n}`);
  } catch (e) {
    L(`  ${t}: <missing> ${(e as Error).message}`);
  }
}
try {
  const sg = q("SELECT status, COUNT(*) n FROM learning_suggestions GROUP BY status");
  for (const r of sg) L(`    suggestion status ${r.status}: ${r.n}`);
} catch { /* */ }
try {
  const scl = q("SELECT by, COUNT(*) n FROM setting_change_log GROUP BY by");
  for (const r of scl) L(`    setting_change by=${r.by}: ${r.n}`);
} catch { /* */ }

L("\n===== paper_price_samples (per-position pnl path) =====");
try {
  const ps = one("SELECT COUNT(*) n, COUNT(DISTINCT position_id) pids FROM paper_price_samples");
  L(`paper_price_samples: rows=${ps.n} distinct positions=${ps.pids}`);
} catch (e) { L(`paper_price_samples: ${(e as Error).message}`); }

db.close();
