import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as Record<string, unknown>;
const L = (s: string) => console.log(s);

L("===== DURABILITY: signals table (reset does NOT touch it) =====");
const sig = one("SELECT COUNT(*) n, MIN(at) mn, MAX(at) mx FROM signals");
L(`signals total=${sig.n}`);
if (sig.mn) {
  const hrs = ((sig.mx as number) - (sig.mn as number)) / 3_600_000;
  L(`signals span: ${new Date(sig.mn as number).toISOString()} .. ${new Date(sig.mx as number).toISOString()} (${hrs.toFixed(1)}h)`);
}
const sigcov = one(`SELECT
  SUM(hypothetical_pnl_sol IS NOT NULL) hyp,
  SUM(real_pnl_sol IS NOT NULL) realp,
  SUM(max_gain_pct IS NOT NULL) gain,
  SUM(price_15m IS NOT NULL) p15,
  SUM(exit_reason IS NOT NULL) exitr
FROM signals`);
L(`signals coverage: hyp_pnl=${sigcov.hyp} real_pnl=${sigcov.realp} max_gain=${sigcov.gain} p15m=${sigcov.p15} exit_reason=${sigcov.exitr}`);
const buyOutcome = one(`SELECT COUNT(*) n, SUM(hypothetical_pnl_sol) totHyp, AVG(hypothetical_pnl_sol) avgHyp
  FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND hypothetical_pnl_sol IS NOT NULL`);
L(`BUY signals w/ hypothetical_pnl_sol: n=${buyOutcome.n} total=${(buyOutcome.totHyp as number)?.toFixed(4)} avg=${(buyOutcome.avgHyp as number)?.toFixed(4)}`);

L("\n===== CURRENT paper ledger state =====");
const pt = one("SELECT COUNT(*) n, SUM(side='buy') buys, SUM(side='sell') sells, MIN(at) mn, MAX(at) mx FROM paper_trades");
L(`paper_trades total=${pt.n} buys=${pt.buys} sells=${pt.sells}`);
if (pt.mn) L(`paper_trades span: ${new Date(pt.mn as number).toISOString()} .. ${new Date(pt.mx as number).toISOString()}`);
const pp = one("SELECT COUNT(*) n, SUM(closed_at_ms IS NOT NULL) closed, SUM(closed_at_ms IS NULL) open FROM paper_positions");
L(`paper_positions total=${pp.n} closed=${pp.closed} open=${pp.open}`);

L("\n===== THE '2x DISAGREEMENT' — population test =====");
// (A) realized_pnl_sol summed over ALL sells (incl partial ladder on OPEN positions)
const sellAll = one("SELECT SUM(realized_pnl_sol) s, COUNT(*) n FROM paper_trades WHERE side='sell'");
L(`(A) sum realized_pnl_sol over ALL sells: ${(sellAll.s as number)?.toFixed(4)} SOL (n=${sellAll.n})`);
// (B) realized_pnl_usd over CLOSED positions only (what the orig probe compared)
const closedUsd = one("SELECT SUM(realized_pnl_usd) s, COUNT(*) n FROM paper_positions WHERE closed_at_ms IS NOT NULL");
L(`(B) sum realized_pnl_usd over CLOSED positions: ${(closedUsd.s as number)?.toFixed(2)} USD (n=${closedUsd.n})`);
// (C) realized_pnl_usd over ALL positions (closed+open) — like-for-like with (A)
const allUsd = one("SELECT SUM(realized_pnl_usd) s, COUNT(*) n FROM paper_positions");
L(`(C) sum realized_pnl_usd over ALL positions: ${(allUsd.s as number)?.toFixed(2)} USD (n=${allUsd.n})`);
// (D) open positions carrying nonzero realized_pnl_usd (partial ladder sells while still open)
const openRealized = one("SELECT COUNT(*) n, SUM(realized_pnl_usd) s FROM paper_positions WHERE closed_at_ms IS NULL AND realized_pnl_usd <> 0");
L(`(D) OPEN positions with realized_pnl_usd<>0 (partial sells, excluded from B): n=${openRealized.n} sum=${(openRealized.s as number)?.toFixed(2)} USD`);
L(`    => (B) excludes (D); (A) includes those partial sells. That is the population gap.`);

L("\n===== WAL/lag context =====");
L(`(probe opened readonly at ${new Date().toISOString()})`);

db.close();
