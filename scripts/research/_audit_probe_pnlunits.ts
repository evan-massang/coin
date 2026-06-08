import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// 1) total realized SOL from paper_trades sell fills
const sellAgg = db.prepare(
  `SELECT COUNT(*) n, COALESCE(SUM(realized_pnl_sol),0) sumsol FROM paper_trades WHERE side='sell'`
).get() as any;
console.log("paper_trades sell fills:", sellAgg.n, "sum realized_pnl_sol:", sellAgg.sumsol);

// also all sides realized_pnl_sol (some impls put pnl on every row)
const allRealized = db.prepare(
  `SELECT COUNT(*) n, COALESCE(SUM(realized_pnl_sol),0) sumsol FROM paper_trades WHERE realized_pnl_sol IS NOT NULL`
).get() as any;
console.log("paper_trades rows w/ realized_pnl_sol not null:", allRealized.n, "sum:", allRealized.sumsol);

// 2) realized USD from paper_positions closed
const posAgg = db.prepare(
  `SELECT COUNT(*) n, COALESCE(SUM(realized_pnl_usd),0) sumusd FROM paper_positions WHERE closed_at_ms IS NOT NULL`
).get() as any;
console.log("paper_positions closed:", posAgg.n, "sum realized_pnl_usd:", posAgg.sumusd);

// all positions realized usd regardless of closed
const posAll = db.prepare(
  `SELECT COUNT(*) n, COALESCE(SUM(realized_pnl_usd),0) sumusd FROM paper_positions`
).get() as any;
console.log("paper_positions all:", posAll.n, "sum realized_pnl_usd:", posAll.sumusd);

// 3) implied SOL price to reconcile
if (sellAgg.sumsol !== 0) {
  console.log("implied SOL price if -SOL == -USD:", posAgg.sumusd / sellAgg.sumsol, "USD/SOL");
}

// 4) cross-check: try converting USD per-position to SOL using a plausible price range
for (const px of [100, 130, 150, 200]) {
  console.log(`  at $${px}/SOL: USD realized -> ${(posAgg.sumusd / px).toFixed(4)} SOL (vs trades ${sellAgg.sumsol.toFixed(4)} SOL)`);
}

// 5) sample a few closed positions to inspect raw values
const sample = db.prepare(
  `SELECT mint, symbol, sol_invested, realized_pnl_usd, cost_basis_usd, entry_price_usd, last_price_usd FROM paper_positions WHERE closed_at_ms IS NOT NULL LIMIT 5`
).all();
console.log("sample closed positions:", JSON.stringify(sample, null, 2));

db.close();
