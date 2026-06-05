/**
 * One-line metrics snapshot for the forward profitability loop (READ-ONLY).
 * Prints a timestamped CSV row: paper PnL + buyStats + forward-path population
 * (verifies the outcome-tracker fix) + live weather/regime. Append to a log:
 *   npx tsx scripts/research/sample.ts >> monitor-cycle5.log
 * `at` is passed in (scripts can't call Date.now in some contexts); we use the
 * DB max(at) and process start as a clock-free stamp source.
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql: string): Record<string, number> => db.prepare(sql).get() as Record<string, number>;

const buys = one(
  "SELECT COUNT(*) n, SUM(CASE WHEN max_gain_pct>=100 THEN 1 ELSE 0 END) wins FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
);
const pathPop = one(
  "SELECT COUNT(price_5m) p5, COUNT(price_15m) p15, COUNT(price_1h) p1h FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')",
);
const totals = one("SELECT COUNT(*) total, MAX(at) lastAt FROM signals");
const winRate = buys.n ? ((buys.wins ?? 0) / buys.n) : 0;

interface PaperStats { totalPnlSol?: number; balanceSol?: number; winRate?: number; openCount?: number; closedCount?: number }
let paper: PaperStats = {};
let weather = "?";
try {
  const r = await fetch("http://127.0.0.1:3000/api/paper");
  if (r.ok) paper = ((await r.json()) as { stats?: PaperStats }).stats ?? {};
} catch { /* engine may be restarting */ }
try {
  const r = await fetch("http://127.0.0.1:3000/api/market");
  if (r.ok) weather = ((await r.json()) as { weather?: string }).weather ?? "?";
} catch { /* ignore */ }

const stamp = new Date(totals.lastAt || 0).toISOString();
// eslint-disable-next-line no-console
console.log(
  `${stamp} | signals=${totals.total} buys=${buys.n} buyWin%=${(winRate * 100).toFixed(1)} | ` +
    `path p5/p15/p1h=${pathPop.p5}/${pathPop.p15}/${pathPop.p1h} | ` +
    `paper pnl=${(paper.totalPnlSol ?? 0).toFixed(3)}SOL bal=${(paper.balanceSol ?? 0).toFixed(3)} ` +
    `open=${paper.openCount ?? 0} closed=${paper.closedCount ?? 0} win%=${((paper.winRate ?? 0) * 100).toFixed(1)} | weather=${weather}`,
);
db.close();
