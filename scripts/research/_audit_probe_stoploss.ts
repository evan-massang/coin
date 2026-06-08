import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// All sells
const sells = db.prepare(
  `SELECT mint, side, realized_pnl_sol, reason, at FROM paper_trades WHERE side='sell'`
).all() as Array<{ mint: string; side: string; realized_pnl_sol: number | null; reason: string | null; at: number }>;

console.log("total sells:", sells.length);
const totalRealized = sells.reduce((s, r) => s + (r.realized_pnl_sol ?? 0), 0);
console.log("total realized across all sells (SOL):", totalRealized.toFixed(4));

// Group by reason prefix
const byReason = new Map<string, { n: number; sum: number }>();
for (const r of sells) {
  const reason = r.reason ?? "(null)";
  const key = reason.split(":")[0].trim();
  const g = byReason.get(key) ?? { n: 0, sum: 0 };
  g.n++;
  g.sum += r.realized_pnl_sol ?? 0;
  byReason.set(key, g);
}
console.log("\n--- by reason prefix ---");
for (const [k, g] of [...byReason.entries()].sort((a, b) => a[1].sum - b[1].sum)) {
  console.log(`${k.padEnd(20)} n=${g.n}  sum=${g.sum.toFixed(4)}  avg=${(g.sum / g.n).toFixed(5)}`);
}

// Stop-loss specific: parse realized breach depth from "Stop loss: X% below entry"
const stops = sells.filter((r) => (r.reason ?? "").startsWith("Stop loss"));
console.log("\n--- stop-loss sells ---");
console.log("count:", stops.length);
const depths: number[] = [];
for (const r of stops) {
  const m = /Stop loss:\s*(-?\d+)% below entry/.exec(r.reason ?? "");
  if (m) depths.push(Number(m[1]));
}
depths.sort((a, b) => a - b);
console.log("parsed depths count:", depths.length);
console.log("min depth (worst):", depths[0], " max depth (shallowest):", depths[depths.length - 1]);
const median = depths.length ? depths[Math.floor(depths.length / 2)] : NaN;
console.log("median depth:", median);
const mean = depths.reduce((s, d) => s + d, 0) / depths.length;
console.log("mean depth:", mean.toFixed(2));

const atOrWorse50 = depths.filter((d) => d >= 50).length; // depth is positive "% below"
const inBand45to49 = depths.filter((d) => d >= 45 && d <= 49).length;
const below45 = depths.filter((d) => d < 45).length;
console.log(`>= 50% below entry: ${atOrWorse50} (${((atOrWorse50 / depths.length) * 100).toFixed(0)}%)`);
console.log(`45..49% band:       ${inBand45to49} (${((inBand45to49 / depths.length) * 100).toFixed(0)}%)`);
console.log(`< 45% (shallower):  ${below45}`);

// distribution buckets
const buckets: Record<string, number> = {};
for (const d of depths) {
  const b = d < 45 ? "<45" : d < 50 ? "45-49" : d < 60 ? "50-59" : d < 70 ? "60-69" : d < 80 ? "70-79" : d < 90 ? "80-89" : "90+";
  buckets[b] = (buckets[b] ?? 0) + 1;
}
console.log("depth buckets:", JSON.stringify(buckets));

// stop-loss realized pnl
const stopSum = stops.reduce((s, r) => s + (r.realized_pnl_sol ?? 0), 0);
console.log("\nstop-loss sum realized (SOL):", stopSum.toFixed(4), " avg:", (stopSum / stops.length).toFixed(5));

// average sol invested per position to sanity-check the "0.04 SOL position" assumption
const pos = db.prepare(`SELECT sol_invested FROM paper_positions`).all() as Array<{ sol_invested: number }>;
const avgInvested = pos.reduce((s, p) => s + (p.sol_invested ?? 0), 0) / (pos.length || 1);
console.log("\npositions:", pos.length, " avg sol_invested:", avgInvested.toFixed(5));

db.close();
