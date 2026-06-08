import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// Overall time span of signals
const span = db.prepare(`SELECT MIN(at) AS minAt, MAX(at) AS maxAt, COUNT(*) AS n FROM signals`).get() as any;
console.log("signals span:", JSON.stringify(span));
const fmt = (ms: number) => new Date(ms).toISOString();
console.log("  min:", fmt(span.minAt), "max:", fmt(span.maxAt));

// Signals per hour for the last 12h relative to max(at)
const maxAt = span.maxAt as number;
console.log("\n--- signals per hour bucket (relative to latest signal) ---");
for (let h = 0; h < 12; h++) {
  const hi = maxAt - h * 3600_000;
  const lo = hi - 3600_000;
  const row = db.prepare(`SELECT COUNT(*) AS c FROM signals WHERE at > ? AND at <= ?`).get(lo, hi) as any;
  console.log(`h-${h}: ${row.c}  [${fmt(lo)} .. ${fmt(hi)}]`);
}

// Gap analysis: largest gaps between consecutive signal timestamps
console.log("\n--- largest inter-signal gaps (min) ---");
const ats = db.prepare(`SELECT at FROM signals ORDER BY at ASC`).all() as any[];
const gaps: { gapMin: number; from: number; to: number }[] = [];
for (let i = 1; i < ats.length; i++) {
  const g = (ats[i].at - ats[i - 1].at) / 60000;
  gaps.push({ gapMin: g, from: ats[i - 1].at, to: ats[i].at });
}
gaps.sort((a, b) => b.gapMin - a.gapMin);
for (const g of gaps.slice(0, 8)) {
  console.log(`gap ${g.gapMin.toFixed(1)}min  ${fmt(g.from)} -> ${fmt(g.to)}`);
}

// How many gaps > 10 min (possible outages)
const big = gaps.filter((g) => g.gapMin > 10).length;
console.log(`\ngaps > 10min: ${big} of ${gaps.length} intervals`);
const total10 = gaps.filter((g) => g.gapMin > 10).reduce((s, g) => s + g.gapMin, 0);
console.log(`total minutes in >10min gaps: ${total10.toFixed(0)}`);

db.close();
