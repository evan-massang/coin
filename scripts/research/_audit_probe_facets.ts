/** READ-ONLY: distinct-value distribution of each facet across signals. */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const rows = db.prepare(`SELECT scores FROM signals WHERE scores IS NOT NULL`).all() as { scores: string }[];
const facets = ["organic", "momentum", "graduation", "devReputation", "smartMoney", "social", "hype"];
const dist: Record<string, Map<number, number>> = {};
for (const f of facets) dist[f] = new Map();
let parsed = 0;
for (const r of rows) {
  let s: any;
  try { s = JSON.parse(r.scores); } catch { continue; }
  parsed++;
  for (const f of facets) {
    const v = s[f];
    if (v == null) { dist[f]!.set(-999, (dist[f]!.get(-999) ?? 0) + 1); continue; }
    const k = Math.round(v);
    dist[f]!.set(k, (dist[f]!.get(k) ?? 0) + 1);
  }
}
console.log(`parsed ${parsed} score blobs`);
for (const f of facets) {
  const m = dist[f]!;
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const distinct = m.size;
  console.log(`\n${f}: distinct=${distinct}  top values [val:count]: ${top.map(([k, c]) => `${k === -999 ? "null" : k}:${c}`).join("  ")}`);
}
db.close();
