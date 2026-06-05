/**
 * Smoke test of LOCAL council seats via the direct Ollama transport.
 * Run: `tsx scripts/test-local-seat.ts [ollama/model:role ...]`.
 */
import { ollamaReview } from "../src/aiComputer/ollamaCouncil.js";
import type { CouncilEvidence } from "../src/aiComputer/councilShared.js";
import type { CouncilRole } from "../src/council/roles.js";

const ev: CouncilEvidence = {
  symbol: "PEPE", state: "DECISION_READY", coverage: 80, convictionTier: "HIGH",
  bullCount: 5, bearCount: 1,
  bullPoints: ["Smart wallet cluster entered", "Organic buying", "RugCheck safety clean", "Buyer velocity rising", "Similar to 1 historical winner"],
  bearPoints: ["Thin liquidity"],
  clusterDetected: true, smartMoney: true, devSold: false, rugMatch: false, marketRegime: "ACCUMULATION", similarWinners: 1,
};

const defaults: Array<[string, CouncilRole]> = [["ollama/gemma2:2b", "risk_analyst"]];
const seats: Array<[string, CouncilRole]> = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => { const [m, r] = s.split("@"); return [m!, (r || "lead_reviewer") as CouncilRole]; })
  : defaults;

for (const [model, role] of seats) {
  const t0 = Date.now();
  const v = await ollamaReview(ev, { baseUrl: "http://127.0.0.1:11434", model, role, timeoutMs: 120000 });
  // eslint-disable-next-line no-console
  console.log(`${model} (${role}) → ${JSON.stringify(v)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
process.exit(0);
