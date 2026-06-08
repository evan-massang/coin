import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const open = db.prepare("SELECT COUNT(*) c FROM paper_positions WHERE closed_at_ms IS NULL").get() as any;
const closed = db.prepare("SELECT COUNT(*) c FROM paper_positions WHERE closed_at_ms IS NOT NULL").get() as any;
const total = db.prepare("SELECT COUNT(*) c FROM paper_positions").get() as any;
console.log("open=", open.c, "closed=", closed.c, "total=", total.c);

// samples table coverage for equity curve feasibility
const sampRows = db.prepare("SELECT COUNT(*) c, COUNT(DISTINCT position_id) p FROM paper_price_samples").get() as any;
console.log("price_samples rows=", sampRows.c, "distinct positions w/ samples=", sampRows.p);

// realized pnl from fills feasibility
try {
  const fills = db.prepare("SELECT COUNT(*) c, COUNT(realized_pnl_sol) nn FROM paper_trades").get() as any;
  console.log("paper_trades rows=", fills.c, "rows w/ realized_pnl_sol=", fills.nn);
} catch (e) { console.log("paper_trades err", String(e)); }

// per-position sample density (median-ish): how many samples per position
const dens = db.prepare("SELECT position_id, COUNT(*) c FROM paper_price_samples GROUP BY position_id ORDER BY c").all() as any[];
if (dens.length) {
  const counts = dens.map(d => d.c);
  const min = counts[0], max = counts[counts.length-1];
  const med = counts[Math.floor(counts.length/2)];
  console.log("samples/position: min=", min, "median=", med, "max=", max, "positionsWithSamples=", counts.length);
}

// realized pnl total (the bleed)
try {
  const r = db.prepare("SELECT SUM(realized_pnl_sol) s FROM paper_trades").get() as any;
  console.log("SUM realized_pnl_sol (paper_trades)=", r.s);
} catch (e) { console.log("sum err", String(e)); }
try {
  const r2 = db.prepare("SELECT SUM(realized_pnl_usd) s FROM paper_positions").get() as any;
  console.log("SUM realized_pnl_usd (paper_positions)=", r2.s);
} catch (e) { console.log("sum2 err", String(e)); }

db.close();
