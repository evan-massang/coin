import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// 1. Any trailing-stop rows ANYWHERE in paper_trades?
console.log("=== paper_trades reasons containing 'trail' ===");
console.log(db.prepare("SELECT COUNT(*) n FROM paper_trades WHERE LOWER(reason) LIKE '%trail%'").get());

// 2. signals.exit_reason distribution + hypothetical PnL bucketed
console.log("\n=== signals.exit_reason distribution (hypothetical_pnl_sol) ===");
const rows = db.prepare(`
  SELECT exit_reason,
         COUNT(*) n,
         ROUND(SUM(hypothetical_pnl_sol),4) sum_pnl,
         ROUND(AVG(hypothetical_pnl_sol),5) avg_pnl,
         SUM(CASE WHEN hypothetical_pnl_sol > 0 THEN 1 ELSE 0 END) wins
  FROM signals
  WHERE hypothetical_pnl_sol IS NOT NULL
  GROUP BY exit_reason
  ORDER BY n DESC
`).all() as any[];
console.table(rows.map(r => ({...r, win_rate: r.n ? +((r.wins/r.n)*100).toFixed(1) : 0})));

// 3. Bucket signals exit_reason like the finding (trailing / ladder / etc)
console.log("\n=== signals exit_reason BUCKETED ===");
const sigs = db.prepare("SELECT hypothetical_pnl_sol p, exit_reason r FROM signals WHERE hypothetical_pnl_sol IS NOT NULL").all() as any[];
const bucket = (r: string) => {
  const s = (r || "").toLowerCase();
  if (s.includes("stop loss") || s.includes("stop-loss")) return "stop_loss";
  if (s.includes("trail")) return "trailing_stop";
  if (s.includes("ladder")) return "profit_ladder";
  if (s.includes("time")) return "time_stop";
  if (s.includes("hard")) return "hard_exit";
  return `other:${r}`;
};
const agg: Record<string, {n:number;sum:number;wins:number}> = {};
for (const s of sigs) {
  const b = bucket(s.r);
  agg[b] ??= {n:0,sum:0,wins:0};
  agg[b].n++; agg[b].sum += s.p ?? 0; if ((s.p??0)>0) agg[b].wins++;
}
console.table(Object.entries(agg).map(([k,v])=>({bucket:k,n:v.n,sum_pnl:+v.sum.toFixed(4),avg_pnl:+(v.sum/v.n).toFixed(5),win_rate:+((v.wins/v.n)*100).toFixed(1)})));

// 4. median max_drawdown_pct across all signals
console.log("\n=== max_drawdown_pct stats (signals) ===");
const dd = db.prepare("SELECT max_drawdown_pct d FROM signals WHERE max_drawdown_pct IS NOT NULL ORDER BY max_drawdown_pct").all() as any[];
if (dd.length) {
  const med = dd[Math.floor(dd.length/2)].d;
  console.log({ n: dd.length, median: med, min: dd[0].d, max: dd[dd.length-1].d });
}

// 5. Of paper positions that peaked >= 2.31x, what happened? How many would trailing catch?
console.log("\n=== paper_positions peak multiple distribution ===");
const pos = db.prepare(`
  SELECT id, symbol, entry_price_usd e, peak_price_usd pk, last_price_usd lp, closed_at_ms c
  FROM paper_positions WHERE entry_price_usd > 0
`).all() as any[];
let peaked231 = 0, peaked15 = 0;
for (const p of pos) {
  const pm = p.pk / p.e;
  if (pm >= 2.31) peaked231++;
  if (pm >= 1.5) peaked15++;
}
console.log({ total: pos.length, peaked_ge_1_5x: peaked15, peaked_ge_2_31x: peaked231 });

db.close();
