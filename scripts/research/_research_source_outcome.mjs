// Hermes shadow A/B (#68): do Manus-researched buys outperform heuristic-researched
// ones? Groups resolved BUY signals by their research provenance flag.
//   node scripts/research/_research_source_outcome.mjs
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const rows = db
  .prepare(
    "SELECT flags, max_gain_pct, max_drawdown_pct FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
  )
  .all();

const groups = { "research:manus": [], "research:heuristic": [], "research:llm": [], unflagged: [] };
for (const r of rows) {
  const flags = r.flags || "";
  const key = flags.includes("research:manus") ? "research:manus" : flags.includes("research:llm") ? "research:llm" : flags.includes("research:heuristic") ? "research:heuristic" : "unflagged";
  groups[key].push(r);
}

const med = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log(`research provenance → outcome on ${rows.length} resolved BUYs\n`);
for (const [k, g] of Object.entries(groups)) {
  if (!g.length) { console.log(`${k.padEnd(20)} n=0`); continue; }
  const gains = g.map((x) => x.max_gain_pct);
  const wins = gains.filter((x) => x >= 100).length;
  console.log(
    `${k.padEnd(20)} n=${String(g.length).padStart(4)} win%(>=2x)=${((wins / g.length) * 100).toFixed(1).padStart(5)} avgPeak=${(gains.reduce((a, b) => a + b, 0) / g.length).toFixed(1).padStart(7)}% medPeak=${med(gains).toFixed(1).padStart(6)}%`,
  );
}
console.log("\n(provenance flags only exist on signals after 2026-06-10 — let it accrue; rerun to compare)");
db.close();
