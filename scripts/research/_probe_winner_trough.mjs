// Read-only probe: do 2x-peak winners REALLY dip below entry (and below the
// stop), once max_drawdown_pct is mapped with the verified peak-relative
// convention? entry-relative trough = (1+gain/100)·(1−dd/100), exact identity.
// This tests the roadmap claim "100% of 2x-winners draw down ≥45% from entry".
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT max_gain_pct g, max_drawdown_pct dd FROM signals
  WHERE verdict LIKE 'BUY%' AND max_gain_pct IS NOT NULL AND max_drawdown_pct IS NOT NULL
`).all();

const buckets = [
  { name: "2x+ winners (peak ≥ 2x)", f: (r) => r.g >= 100 },
  { name: "1.5x–2x peaks", f: (r) => r.g >= 50 && r.g < 100 },
  { name: "all BUYs", f: () => true },
];
for (const b of buckets) {
  const set = rows.filter(b.f);
  const trough = set.map((r) => (1 + r.g / 100) * (1 - r.dd / 100));
  const below = (t) => trough.filter((x) => x <= t).length;
  const n = set.length;
  console.log(
    `${b.name}: n=${n}` +
      `  trough≤entry: ${below(1)} (${((100 * below(1)) / n).toFixed(1)}%)` +
      `  ≤0.8: ${below(0.8)} (${((100 * below(0.8)) / n).toFixed(1)}%)` +
      `  ≤0.6 (stop40): ${below(0.6)} (${((100 * below(0.6)) / n).toFixed(1)}%)` +
      `  ≤0.55 (stop45): ${below(0.55)} (${((100 * below(0.55)) / n).toFixed(1)}%)`,
  );
}
