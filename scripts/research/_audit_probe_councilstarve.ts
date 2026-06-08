import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function one(sql: string, ...args: any[]): any {
  return db.prepare(sql).get(...args);
}

// --- council_opinions resolution ---
const totalOps = one("SELECT COUNT(*) n FROM council_opinions").n;
const resolvedOps = one("SELECT COUNT(*) n FROM council_opinions WHERE outcome IS NOT NULL").n;
const winOps = one("SELECT COUNT(*) n FROM council_opinions WHERE outcome='win'").n;
const lossOps = one("SELECT COUNT(*) n FROM council_opinions WHERE outcome='loss'").n;
const distinctMints = one("SELECT COUNT(DISTINCT mint) n FROM council_opinions").n;
const distinctResolvedMints = one("SELECT COUNT(DISTINCT mint) n FROM council_opinions WHERE outcome IS NOT NULL").n;

console.log("=== council_opinions ===");
console.log("total opinions:", totalOps);
console.log("resolved opinions:", resolvedOps, `(${(100*resolvedOps/Math.max(1,totalOps)).toFixed(1)}%)`);
console.log("  win:", winOps, "loss:", lossOps);
console.log("distinct mints debated:", distinctMints);
console.log("distinct mints resolved:", distinctResolvedMints, `(${(100*distinctResolvedMints/Math.max(1,distinctMints)).toFixed(1)}%)`);

// per-seat resolved counts
console.log("\n=== per-seat resolved counts ===");
const perSeat = db.prepare(
  `SELECT member_id, COUNT(*) total,
          SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) resolved,
          SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) wins
   FROM council_opinions GROUP BY member_id ORDER BY total DESC`
).all() as any[];
for (const r of perSeat) {
  console.log(`${r.member_id}: total=${r.total} resolved=${r.resolved} wins=${r.wins} weightActive=${r.resolved>=8}`);
}

// --- verdict mix of debated coins (join signals) ---
console.log("\n=== verdict mix of debated mints (latest signal verdict per mint) ===");
const verdictMix = db.prepare(
  `SELECT s.verdict v, COUNT(DISTINCT co.mint) n
   FROM council_opinions co
   LEFT JOIN signals s ON s.mint = co.mint
   GROUP BY s.verdict ORDER BY n DESC`
).all() as any[];
for (const r of verdictMix) console.log(`  verdict=${r.v}: ${r.n} mints`);

// --- signals BUY win-eligibility ---
console.log("\n=== signals ===");
const buyTotal = one("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')").n;
const buyWin = one("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct >= 100").n;
const buyLoss = one("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_drawdown_pct >= 50").n;
const buyNeither = one("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND (max_gain_pct IS NULL OR max_gain_pct < 100) AND (max_drawdown_pct IS NULL OR max_drawdown_pct < 50)").n;
console.log("BUY signals:", buyTotal);
console.log("  with max_gain_pct>=100 (win-eligible):", buyWin, `(${(100*buyWin/Math.max(1,buyTotal)).toFixed(1)}%)`);
console.log("  with max_drawdown_pct>=50 (loss-eligible):", buyLoss, `(${(100*buyLoss/Math.max(1,buyTotal)).toFixed(1)}%)`);
console.log("  neither (never resolvable):", buyNeither, `(${(100*buyNeither/Math.max(1,buyTotal)).toFixed(1)}%)`);

// --- paper positions closed ---
console.log("\n=== paper_positions ===");
const ppTotal = one("SELECT COUNT(*) n FROM paper_positions").n;
const ppClosed = one("SELECT COUNT(*) n FROM paper_positions WHERE closed_at_ms IS NOT NULL").n;
console.log("total:", ppTotal, "closed:", ppClosed);

// realized pnl sign distribution for closed positions
const pnlSign = one(
  `SELECT SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) pos,
          SUM(CASE WHEN realized_pnl_usd <= 0 THEN 1 ELSE 0 END) nonpos
   FROM paper_positions WHERE closed_at_ms IS NOT NULL`
);
console.log("closed positions realized_pnl_usd: >0:", pnlSign.pos, "<=0:", pnlSign.nonpos);

db.close();
