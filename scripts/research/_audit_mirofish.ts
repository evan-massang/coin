/** READ-ONLY: is MiroFish sizing pinned at the floor? Distribution of risk on BUYs.
 *   npx tsx scripts/research/_audit_mirofish.ts */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const buys = db.prepare(`SELECT risk_tier, suggested_risk_pct, market_weather, conviction FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`).all() as { risk_tier: string | null; suggested_risk_pct: number | null; market_weather: string | null; conviction: number }[];
console.log(`BUYs: ${buys.length}`);
const tier: Record<string, number> = {}, wx: Record<string, number> = {};
const pcts: number[] = [];
for (const b of buys) { tier[b.risk_tier ?? "?"] = (tier[b.risk_tier ?? "?"] ?? 0) + 1; wx[b.market_weather ?? "?"] = (wx[b.market_weather ?? "?"] ?? 0) + 1; if (b.suggested_risk_pct != null) pcts.push(b.suggested_risk_pct); }
console.log(`risk tiers: ${Object.entries(tier).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`market weather: ${Object.entries(wx).map(([k, v]) => `${k}=${v}`).join("  ")}`);
if (pcts.length) {
  pcts.sort((a, b) => a - b);
  const at0_1 = pcts.filter((x) => x <= 0.11).length;
  console.log(`suggested_risk_pct: min ${pcts[0]} median ${pcts[Math.floor(pcts.length / 2)]} max ${pcts[pcts.length - 1]} mean ${(pcts.reduce((s, x) => s + x, 0) / pcts.length).toFixed(3)}`);
  console.log(`  at/near the 0.1% floor (<=0.11): ${at0_1}/${pcts.length} (${((at0_1 / pcts.length) * 100).toFixed(1)}%)`);
}
// actual paper position size
const pos = db.prepare(`SELECT sol_invested FROM paper_positions`).all() as { sol_invested: number }[];
if (pos.length) { const s = pos.map((p) => p.sol_invested).sort((a, b) => a - b); console.log(`paper position SOL: min ${s[0]} median ${s[Math.floor(s.length / 2)]} max ${s[s.length - 1]}`); }
db.close();
