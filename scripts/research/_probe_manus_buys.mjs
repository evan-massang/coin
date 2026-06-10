// What did the engine buy on Manus-validated research?
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const buys = db
  .prepare("SELECT mint, sol_amount, price_usd, at FROM paper_trades WHERE side='buy' AND at > ? ORDER BY at DESC LIMIT 10")
  .all(Date.now() - 45 * 60_000);
for (const b of buys) {
  const sig = db
    .prepare("SELECT symbol, verdict, conviction, flags FROM signals WHERE mint=? AND verdict IN ('BUY_SMALL','BUY_STRONG') ORDER BY at DESC LIMIT 1")
    .get(b.mint);
  const manus = (sig?.flags || "").includes("research:manus");
  console.log(
    `${new Date(b.at).toISOString().slice(11, 19)} BUY $${sig?.symbol ?? b.mint.slice(0, 8)} ${b.sol_amount.toFixed(3)} SOL @ $${b.price_usd} — ${sig?.verdict}@${sig?.conviction} ${manus ? "✓ MANUS-VALIDATED" : "(local research)"}`,
  );
}
const pos = db
  .prepare("SELECT p.mint, p.symbol, p.status, p.sol_invested, p.entry_price_usd, p.last_price_usd FROM paper_positions p WHERE p.status!='CLOSED' AND p.entry_at_ms > ? ORDER BY p.entry_at_ms DESC LIMIT 10")
  .all(Date.now() - 45 * 60_000);
console.log("\nfresh open positions:");
for (const p of pos) {
  const pnl = p.entry_price_usd > 0 && p.last_price_usd ? ((p.last_price_usd / p.entry_price_usd - 1) * 100).toFixed(1) : "?";
  console.log(`  $${p.symbol ?? p.mint.slice(0, 8)} ${p.status} inv=${p.sol_invested.toFixed(3)} SOL pnl=${pnl}%`);
}
db.close();
