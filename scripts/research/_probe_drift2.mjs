// Drift mechanism probe: per-mint token conservation + realized reconciliation.
// If SUM(sold tokens) > SUM(bought tokens) for a mint, the sim credited cash for
// tokens that never existed (stale-position double-sell) — cash is the fiction.
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });

const perMint = db.prepare(`
  SELECT mint,
    SUM(CASE WHEN side='buy'  THEN token_amount ELSE 0 END) AS bought,
    SUM(CASE WHEN side='sell' THEN token_amount ELSE 0 END) AS sold,
    SUM(CASE WHEN side='buy'  THEN sol_amount ELSE 0 END) AS buySol,
    SUM(CASE WHEN side='sell' THEN sol_amount ELSE 0 END) AS sellSol,
    SUM(CASE WHEN side='sell' THEN realized_pnl_sol ELSE 0 END) AS ledgerR,
    COUNT(CASE WHEN side='sell' THEN 1 END) AS sells
  FROM paper_trades GROUP BY mint`).all();

let overSold = 0, overSoldSol = 0, totalDelta = 0;
const worst = [];
for (const m of perMint) {
  const ratio = m.bought > 0 ? m.sold / m.bought : Infinity;
  // True realized for this mint (if fully closed) = proceeds − cost. Compare ledger.
  const trueR = m.sellSol - m.buySol; // exact only when fully closed; aggregate ≈ ok
  const delta = trueR - m.ledgerR;
  totalDelta += delta;
  if (ratio > 1.01) {
    overSold++;
    // Phantom proceeds ≈ sellSol × (sold − bought)/sold
    overSoldSol += m.sold > 0 ? m.sellSol * ((m.sold - m.bought) / m.sold) : 0;
    worst.push({ mint: m.mint.slice(0, 8), ratio: ratio.toFixed(2), sells: m.sells, sellSol: m.sellSol.toFixed(3), buySol: m.buySol.toFixed(3), ledgerR: m.ledgerR.toFixed(3), delta: delta.toFixed(3) });
  }
}
worst.sort((a, b) => Number(b.delta) - Number(a.delta));
console.log(`mints traded: ${perMint.length}`);
console.log(`mints with sold > bought tokens (phantom sells): ${overSold}`);
console.log(`estimated phantom proceeds: ${overSoldSol.toFixed(3)} SOL`);
console.log(`aggregate (true − ledger) delta: ${totalDelta.toFixed(3)} SOL  (should ≈ +59 if this explains the drift)`);
console.log(`\nworst 12 offenders (sold/bought ratio):`);
for (const x of worst.slice(0, 12)) console.log(` `, JSON.stringify(x));

// Same-mint sells within 3s of each other (the stale-snapshot signature)
const burst = db.prepare(`
  SELECT COUNT(*) n FROM paper_trades a JOIN paper_trades b
    ON a.mint=b.mint AND a.side='sell' AND b.side='sell' AND a.id<b.id AND (b.at-a.at) BETWEEN 0 AND 3000`).get();
console.log(`\nsame-mint sell pairs within 3s: ${burst.n}`);
db.close();
