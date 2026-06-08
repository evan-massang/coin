import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as Record<string, unknown>;
const q = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as Record<string, unknown>[];
const L = (s: string) => console.log(s);

L(`probe time: ${new Date().toISOString()}`);
const pt = one("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN side='sell' THEN realized_pnl_sol END),0) sol FROM paper_trades");
L(`paper_trades rows=${pt.n} sumSellSol=${(pt.sol as number).toFixed(4)}`);
const pp = one("SELECT COUNT(*) n, SUM(CASE WHEN closed_at_ms IS NOT NULL THEN 1 ELSE 0 END) closed, SUM(CASE WHEN closed_at_ms IS NULL THEN 1 ELSE 0 END) open, COALESCE(SUM(realized_pnl_usd),0) usd FROM paper_positions");
L(`paper_positions rows=${pp.n} closed=${pp.closed} open=${pp.open} sumRealizedUsd=${(pp.usd as number).toFixed(2)}`);
const wal = one("PRAGMA wal_checkpoint(PASSIVE)");
L(`wal_checkpoint: ${JSON.stringify(wal)}`);

// peak vs realized using closed positions (coalesce)
const rows = q(`SELECT pp.mint, pp.sol_invested inv,
   (SELECT COALESCE(SUM(realized_pnl_sol),0) FROM paper_trades pt WHERE pt.mint=pp.mint AND pt.side='sell') realSol,
   (SELECT max_gain_pct FROM signals s WHERE s.mint=pp.mint AND s.verdict IN ('BUY_SMALL','BUY_STRONG') ORDER BY s.at LIMIT 1) peak
   FROM paper_positions pp WHERE pp.closed_at_ms IS NOT NULL`);
let n=0,sp=0,sr=0,pw=0,rw=0;
for(const r of rows){const inv=r.inv as number; if(!(inv>0))continue; const rp=((r.realSol as number)/inv)*100; const pk=(r.peak as number)??0; n++; sp+=pk; sr+=rp; if(pk>=100)pw++; if(rp>0)rw++;}
L(`\nclosed matched=${n}`);
if(n>0){
  L(`avg PEAK max_gain_pct = ${(sp/n).toFixed(1)}%   (this is what the learning loop calls the outcome)`);
  L(`avg REALIZED on capital = ${(sr/n).toFixed(1)}%  (what the paper account actually captured)`);
  L(`PEAK>=100 win = ${pw}/${n} (${(100*pw/n).toFixed(1)}%) | REALIZED>0 win = ${rw}/${n} (${(100*rw/n).toFixed(1)}%)`);
}
db.close();
