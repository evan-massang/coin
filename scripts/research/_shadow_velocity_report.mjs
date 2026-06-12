// SHADOW velocityExit report (read-only). Run after 3-5 days of accrual:
//   node scripts/research/_shadow_velocity_report.mjs
// Per variant X ∈ {8,12,15}: realized PnL if we had sold 100% at the trigger
// (2% sell slippage), vs what the REAL exits did on the same positions (durable
// realized_trades journal), vs the corrected firstSpike sweep bounds.
import Database from "better-sqlite3";
import path from "node:path";

const SLIP = 0.02;
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const span = db.prepare("SELECT MIN(triggered_at) f, MAX(triggered_at) l, COUNT(*) n FROM shadow_velocity_exits").get();
if (!span.n) {
  console.log("no shadow velocity triggers recorded yet — engine accrues them live (variants 8/12/15pp within 90s, in-profit only)");
  process.exit(0);
}
console.log(`shadow velocity triggers: ${span.n} rows, ${new Date(span.f).toISOString()} → ${new Date(span.l).toISOString()} (${((span.l - span.f) / 86_400_000).toFixed(2)} days; spec wants 3-5)\n`);

const fmt = (x, d = 2) => (x >= 0 ? "+" : "") + x.toFixed(d);
for (const variant of [8, 12, 15]) {
  const rows = db.prepare(`
    SELECT s.*, rt.realized_pnl_pct AS actual_pct, rt.realized_pnl_sol AS actual_sol, rt.sol_invested AS inv,
           p.status AS pos_status, p.last_price_usd, p.entry_price_usd
    FROM shadow_velocity_exits s
    LEFT JOIN realized_trades rt ON rt.position_id = s.position_id
    LEFT JOIN paper_positions p ON p.id = s.position_id
    WHERE s.variant_pct = ?
  `).all(variant);
  if (!rows.length) {
    console.log(`variant ${variant}pp: 0 triggers`);
    continue;
  }
  const closed = rows.filter((r) => r.actual_pct != null);
  const shadowPct = (r) => ((1 + r.pnl_pct_at_trigger / 100) * (1 - SLIP) - 1) * 100;
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const shadowAll = mean(rows.map(shadowPct));
  const shadowClosed = mean(closed.map(shadowPct));
  const actualClosed = mean(closed.map((r) => r.actual_pct));
  const stillOpen = rows.length - closed.length;
  console.log(`variant ${variant}pp: ${rows.length} triggers (${closed.length} closed, ${stillOpen} still open)`);
  console.log(`  shadow sell-at-trigger (all):    ${fmt(shadowAll)}%/trade (slip ${SLIP * 100}%)`);
  if (closed.length) {
    console.log(`  closed-only — shadow ${fmt(shadowClosed)}% vs ACTUAL exits ${fmt(actualClosed)}% → edge ${fmt(shadowClosed - actualClosed)}pp/trade over ${closed.length} trades`);
    const wins = closed.filter((r) => shadowPct(r) > r.actual_pct).length;
    console.log(`  shadow beat the real exit on ${wins}/${closed.length} (${((100 * wins) / closed.length).toFixed(0)}%)`);
  }
  console.log("");
}

console.log("context — corrected firstSpike sweep on 3,390 historical BUYs (2026-06-12):");
console.log("  baseline early-harvest: opt −8.13% / pess −13.96% per trade");
console.log("  best firstSpike (5x, 10% runner): −6.39% / −11.40%; no-ladder control: −6.83% / −10.24%");
console.log("decision rule: velocityExit graduates to a real exit style ONLY if the shadow's");
console.log("closed-only edge is positive over ≥30 closed trades AND it would not have");
console.log("amputated the 2x+ winners (check max peak_multiple among its trigger positions).");
