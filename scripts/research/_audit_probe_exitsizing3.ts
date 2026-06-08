import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Pos = {
  id: number; mint: string; symbol: string | null; status: string;
  entry_at_ms: number; closed_at_ms: number | null; sol_invested: number;
  entry_price_usd: number; peak_price_usd: number; last_price_usd: number;
};
const positions = db.prepare(`SELECT id,mint,symbol,status,entry_at_ms,closed_at_ms,sol_invested,entry_price_usd,peak_price_usd,last_price_usd FROM paper_positions`).all() as Pos[];
const allSells = db.prepare(`SELECT mint, sol_amount, realized_pnl_sol, reason, at FROM paper_trades WHERE side='sell' ORDER BY at`).all() as any[];
const allBuys = db.prepare(`SELECT mint, sol_amount, reason, at FROM paper_trades WHERE side='buy' ORDER BY at`).all() as any[];

// map first buy reason (verdict) per mint
const buyVerdict = new Map<string, string>();
for (const b of allBuys) if (!buyVerdict.has(b.mint)) buyVerdict.set(b.mint, b.reason);

function sellsFor(p: Pos) {
  const end = p.closed_at_ms ?? Number.MAX_SAFE_INTEGER;
  return allSells.filter((s) => s.mint === p.mint && s.at >= p.entry_at_ms && s.at <= end);
}

// ── Per-position net realized (CLOSED) by verdict ──
const closed = positions.filter((p) => p.status === "CLOSED");
const stat = (label: string, ps: Pos[]) => {
  let net = 0, w = 0, l = 0; const nets: number[] = [];
  for (const p of ps) { const n = sellsFor(p).reduce((a, s) => a + (s.realized_pnl_sol ?? 0), 0); net += n; nets.push(n); if (n > 0) w++; else l++; }
  const invested = ps.reduce((a, p) => a + p.sol_invested, 0);
  console.log(`${label}: n=${ps.length} netPnL=${net.toFixed(4)} SOL  invested=${invested.toFixed(3)}  ROI=${invested>0?((net/invested)*100).toFixed(1):"-"}%  win=${w} lose=${l} winRate=${ps.length?((w/ps.length)*100).toFixed(1):"-"}%`);
  return { net, invested };
};
console.log("=== CLOSED positions net realized by verdict ===");
stat("ALL closed", closed);
stat("BUY_SMALL ", closed.filter((p) => buyVerdict.get(p.mint) === "BUY_SMALL"));
stat("BUY_STRONG", closed.filter((p) => buyVerdict.get(p.mint) === "BUY_STRONG"));

// ── Outcome quality by verdict: peak multiple reached ──
console.log("\n=== peak multiple reached by verdict (ALL positions) ===");
for (const v of ["BUY_SMALL", "BUY_STRONG"]) {
  const ps = positions.filter((p) => buyVerdict.get(p.mint) === v);
  const mults = ps.map((p) => p.entry_price_usd > 0 ? p.peak_price_usd / p.entry_price_usd : 0);
  const h2 = mults.filter((m) => m >= 2).length;
  const avg = mults.reduce((a, m) => a + m, 0) / (mults.length || 1);
  console.log(`${v}: n=${ps.length}  avgPeakMult=${avg.toFixed(2)}x  >=2x: ${h2} (${((h2/ps.length)*100).toFixed(1)}%)`);
}

// ── Trailing-stop puzzle: reconstruct full lifecycle for trailing-exit positions ──
console.log("\n=== Trailing-stop positions: full trade ledger ===");
const trailMints = new Set(allSells.filter((s) => (s.reason || "").toLowerCase().includes("trailing")).map((s) => s.mint));
let shown = 0;
for (const p of positions) {
  if (!trailMints.has(p.mint)) continue;
  if (shown++ >= 8) break;
  const buys = allBuys.filter((b) => b.mint === p.mint);
  const sells = allSells.filter((s) => s.mint === p.mint);
  const peakMult = p.entry_price_usd > 0 ? p.peak_price_usd / p.entry_price_usd : 0;
  const net = sells.reduce((a, s) => a + (s.realized_pnl_sol ?? 0), 0);
  console.log(`\n${p.symbol ?? p.mint.slice(0,6)} status=${p.status} peakMult=${peakMult.toFixed(2)}x invested=${p.sol_invested.toFixed(4)} netRealized=${net.toFixed(4)}`);
  for (const b of buys) console.log(`   BUY  ${b.sol_amount.toFixed(4)} SOL  [${b.reason}]`);
  for (const s of sells) console.log(`   SELL ${s.sol_amount.toFixed(4)} SOL  pnl=${(s.realized_pnl_sol??0).toFixed(4)}  [${s.reason}]`);
}

db.close();
