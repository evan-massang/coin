/** READ-ONLY: live scan via GeckoTerminal — does the Golden Filter find maturing coins?
 *   npx tsx scripts/research/_audit_scantest.ts */
import { statsFromGeckoPools, passesGoldenFilter, type GoldenFilter, type PairStats } from "../../src/sources/dexScanner.js";

const F: GoldenFilter = { minMcapUsd: 50_000, maxMcapUsd: 200_000, minLiqUsd: 30_000, minVolMcRatio: 2, maxAgeHours: 6 };
const G = "https://api.geckoterminal.com/api/v2/networks/solana";
const now = Date.now();
const all = new Map<string, PairStats>();
for (const u of [`${G}/new_pools?page=1`, `${G}/new_pools?page=2`, `${G}/trending_pools?page=1`]) {
  const r = await fetch(u, { headers: { accept: "application/json" } });
  const j = (await r.json()) as { data?: any[] };
  for (const s of statsFromGeckoPools(j.data ?? [], now).values()) if (!all.has(s.mint)) all.set(s.mint, s);
}
const list = [...all.values()];
console.log(`scanned pools: ${list.length}`);
const pass = list.filter((s) => passesGoldenFilter(s, F, now));
console.log(`\n── GOLDEN FILTER survivors: ${pass.length} ──`);
for (const s of pass.slice(0, 20)) {
  console.log(`  $${(s.symbol ?? "?").slice(0, 10).padEnd(10)} mc=$${Math.round((s.mcapUsd ?? 0) / 1000)}k liq=$${Math.round((s.liqUsd ?? 0) / 1000)}k vol/mc=${((s.vol24Usd ?? 0) / (s.mcapUsd || 1)).toFixed(1)} age=${((s.ageMs ?? 0) / 3_600_000).toFixed(1)}h`);
}
// distribution of why others were rejected
const reasons: Record<string, number> = {};
for (const s of list) {
  if (passesGoldenFilter(s, F, now)) continue;
  const r = s.mcapUsd == null || s.liqUsd == null || s.vol24Usd == null || s.ageMs == null ? "missing data"
    : s.mcapUsd < F.minMcapUsd ? "mc<50k" : s.mcapUsd > F.maxMcapUsd ? "mc>200k"
    : s.liqUsd < F.minLiqUsd ? "liq<30k" : (s.vol24Usd ?? 0) / (s.mcapUsd || 1) < F.minVolMcRatio ? "vol/mc<2"
    : (s.ageMs ?? 0) > F.maxAgeHours * 3.6e6 ? "age>6h" : "?";
  reasons[r] = (reasons[r] ?? 0) + 1;
}
console.log(`\nrejections: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join("  ")}`);
