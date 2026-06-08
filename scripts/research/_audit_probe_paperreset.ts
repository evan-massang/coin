import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const wallet = db.prepare("SELECT * FROM paper_wallet WHERE id=1").get() as any;
console.log("paper_wallet:", JSON.stringify(wallet));
if (wallet) {
  console.log("  created_at ISO:", new Date(wallet.created_at).toISOString());
  console.log("  updated_at ISO:", new Date(wallet.updated_at).toISOString());
}

const trades = db.prepare("SELECT side, COUNT(*) n FROM paper_trades GROUP BY side").all();
console.log("paper_trades by side:", JSON.stringify(trades));

const tradeSpan = db.prepare("SELECT MIN(at) mn, MAX(at) mx, COUNT(*) c FROM paper_trades").get() as any;
console.log("paper_trades span:", JSON.stringify(tradeSpan));
if (tradeSpan && tradeSpan.mn) {
  console.log("  earliest trade ISO:", new Date(tradeSpan.mn).toISOString());
  console.log("  latest trade ISO:", new Date(tradeSpan.mx).toISOString());
}

const posByClosed = db.prepare(
  "SELECT CASE WHEN closed_at_ms IS NULL THEN 'OPEN' ELSE 'CLOSED' END st, COUNT(*) n FROM paper_positions GROUP BY st"
).all();
console.log("paper_positions by closed:", JSON.stringify(posByClosed));

const posTotal = db.prepare("SELECT COUNT(*) c FROM paper_positions").get() as any;
console.log("paper_positions total:", posTotal.c);

const samples = db.prepare("SELECT COUNT(*) c, MIN(at) mn, MAX(at) mx FROM paper_price_samples").get() as any;
console.log("paper_price_samples:", JSON.stringify(samples));
if (samples && samples.mn) {
  console.log("  earliest sample ISO:", new Date(samples.mn).toISOString());
  console.log("  latest sample ISO:", new Date(samples.mx).toISOString());
}

// Any trades BEFORE the wallet created_at? If reset wiped history, none should predate it.
if (wallet) {
  const before = db.prepare("SELECT COUNT(*) c FROM paper_trades WHERE at < ?").get(wallet.created_at) as any;
  console.log("trades before wallet.created_at:", before.c);
}

// Cross-check: signals table for longitudinal history that survives reset
const sig = db.prepare("SELECT COUNT(*) c, MIN(at) mn, MAX(at) mx FROM signals").get() as any;
console.log("signals total:", JSON.stringify(sig));
if (sig && sig.mn) {
  console.log("  signals earliest ISO:", new Date(sig.mn).toISOString());
  console.log("  signals latest ISO:", new Date(sig.mx).toISOString());
}
const sigBuy = db.prepare("SELECT COUNT(*) c FROM signals WHERE hypothetical_pnl_sol IS NOT NULL").get() as any;
console.log("signals with hypothetical_pnl_sol NOT NULL:", sigBuy.c);

db.close();
