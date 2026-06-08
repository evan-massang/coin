import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const q = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as Record<string, unknown>[];
const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as Record<string, unknown>;
const L = (s: string) => console.log(s);

L("===== price_5m vs price_15m: is the distinction real? =====");
// Are identical pairs mostly dead coins (price5m == price_at_alert too)?
const idTriple = one(`SELECT COUNT(*) n,
  SUM(price_5m = price_at_alert) eqEntry,
  SUM(price_5m = price_15m AND price_15m = price_1h) eqAll3
  FROM signals WHERE price_5m IS NOT NULL AND price_15m IS NOT NULL`);
L(`pairs w/ p5m & p15m: ${idTriple.n}; p5m==entry: ${idTriple.eqEntry}; p5m==p15m==p1h: ${idTriple.eqAll3}`);
// sample 10 identical-pair rows to eyeball
L("sample identical p5m==p15m rows (symbol, entry, p5m, p15m, p1h, max_gain):");
for (const r of q(`SELECT symbol, price_at_alert e, price_5m a, price_15m b, price_1h c, max_gain_pct g
   FROM signals WHERE price_5m=price_15m AND price_5m IS NOT NULL AND verdict IN ('BUY_SMALL','BUY_STRONG') LIMIT 8`)) {
  L(`  ${String(r.symbol).padEnd(10)} e=${r.e} 5m=${r.a} 15m=${r.b} 1h=${r.c} maxGain=${(r.g as number)?.toFixed(0)}%`);
}
// how often do p5m and p15m differ for coins that actually moved (max_gain>20)?
const movers = one(`SELECT COUNT(*) n, SUM(price_5m=price_15m) same FROM signals
  WHERE price_5m IS NOT NULL AND price_15m IS NOT NULL AND max_gain_pct > 20`);
L(`among movers (max_gain>20): ${movers.n} have both samples; ${movers.same} have identical p5m==p15m`);

L("\n===== LEDGER RECONCILE: paper_trades(SOL) vs paper_positions(USD) =====");
const sell = one("SELECT SUM(realized_pnl_sol) sol FROM paper_trades WHERE side='sell'");
const pos = one("SELECT SUM(realized_pnl_usd) usd FROM paper_positions");
L(`SUM paper_trades.realized_pnl_sol (sells) = ${(sell.sol as number)?.toFixed(4)} SOL`);
L(`SUM paper_positions.realized_pnl_usd       = ${(pos.usd as number)?.toFixed(2)} USD`);
L(`implied SOL/USD if these described the SAME flow: ${((pos.usd as number)/(sell.sol as number)).toFixed(1)}`);
// per-mint reconcile: does closing a position's realized_pnl_usd match its sell fills?
L("\nper-position vs its sell fills (first 8 closed):");
for (const p of q(`SELECT id, mint, symbol, realized_pnl_usd, sol_invested, cost_basis_usd FROM paper_positions WHERE closed_at_ms IS NOT NULL LIMIT 8`)) {
  const fills = one("SELECT SUM(realized_pnl_sol) sol, COUNT(*) n FROM paper_trades WHERE mint=? AND side='sell'", p.mint);
  L(`  pos#${p.id} ${String(p.symbol).padEnd(8)} posUsd=${(p.realized_pnl_usd as number)?.toFixed(2)} | fills sells=${fills.n} sumSol=${(fills.sol as number)?.toFixed(4)}`);
}

L("\n===== PEAK (max_gain_pct, what learning uses) vs REALIZED (paper) =====");
// For paper-traded mints, compare the signal's max_gain_pct (peak) to actual realized return.
const rows = q(`SELECT pp.mint, pp.symbol, pp.sol_invested, pp.closed_at_ms,
    (SELECT SUM(realized_pnl_sol) FROM paper_trades pt WHERE pt.mint=pp.mint AND pt.side='sell') realizedSol,
    (SELECT max_gain_pct FROM signals s WHERE s.mint=pp.mint AND s.verdict IN ('BUY_SMALL','BUY_STRONG') ORDER BY s.at LIMIT 1) peakPct
  FROM paper_positions pp WHERE pp.closed_at_ms IS NOT NULL`);
let nPos = 0, sumPeak = 0, sumRealizedPct = 0, peakWin = 0, realWin = 0;
for (const r of rows) {
  const inv = r.sol_invested as number;
  const realSol = (r.realizedSol as number) ?? 0;
  const peak = (r.peakPct as number) ?? 0;
  if (inv > 0) {
    const realPct = (realSol / inv) * 100;
    nPos++; sumPeak += peak; sumRealizedPct += realPct;
    if (peak >= 100) peakWin++;
    if (realPct > 0) realWin++;
  }
}
L(`closed positions matched=${nPos}`);
L(`avg PEAK max_gain_pct (learning's signal) = ${(sumPeak/nPos).toFixed(1)}%`);
L(`avg REALIZED return on capital (paper)    = ${(sumRealizedPct/nPos).toFixed(1)}%`);
L(`"win" by PEAK>=100 (learning isWin)       = ${peakWin}/${nPos} = ${(100*peakWin/nPos).toFixed(1)}%`);
L(`"win" by REALIZED>0 (actual money)        = ${realWin}/${nPos} = ${(100*realWin/nPos).toFixed(1)}%`);

L("\n===== OPEN-POSITION OVERHANG (unrealized never marked at stop) =====");
const open = one("SELECT COUNT(*) n, SUM(sol_invested) inv FROM paper_positions WHERE closed_at_ms IS NULL");
L(`open positions=${open.n} sol_invested locked=${(open.inv as number)?.toFixed(3)} SOL (PnL unrealized, not in any realized number)`);
// last price sample age for open positions
const lastSample = one(`SELECT MAX(at) mx FROM paper_price_samples`);
if (lastSample.mx) L(`last paper_price_sample at: ${new Date(lastSample.mx as number).toISOString()}`);

db.close();
