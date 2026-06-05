/**
 * Runs the REAL local council (whichever Ollama models are pulled) on one token,
 * then serves the dashboard so the Council Room shows genuine local-model output.
 * Seats whose model isn't pulled yet drop out gracefully. Run with an isolated DB:
 *   DATA_DIR=./.verify-data PORT=3014 NO_OPEN=1 tsx scripts/run-local-council.ts
 */
import { createServices } from "../src/services.js";
import { startServer } from "../src/dashboard/server.js";
import { ollamaReview } from "../src/aiComputer/ollamaCouncil.js";
import { buildConsensus } from "../src/council/consensus.js";
import { buildEvidencePrompt, type CouncilEvidence, type CouncilMemberResult } from "../src/aiComputer/councilShared.js";
import { ROLE_PROMPT, type CouncilRole } from "../src/council/roles.js";
import { emptyScores, type Decision } from "../src/types.js";

const MINT = "PEPElocal1111111111111111111111111111111111".slice(0, 44);

const svc = createServices();
svc.settings.update(
  {
    opencodeEnabled: true,
    ollamaBaseUrl: "http://127.0.0.1:11434",
    councilMembers: [
      { id: "qwen", label: "Qwen 3B", role: "bull_analyst", provider: "opencode", model: "ollama/qwen2.5:3b", enabled: true },
      { id: "llama", label: "Llama 3.2", role: "narrative_analyst", provider: "opencode", model: "ollama/llama3.2:3b", enabled: true },
      { id: "gemma", label: "Gemma 2", role: "risk_analyst", provider: "opencode", model: "ollama/gemma2:2b", enabled: true },
      { id: "phi", label: "Phi 3.5", role: "contrarian", provider: "opencode", model: "ollama/phi3.5", enabled: true },
      { id: "qwen-lead", label: "Qwen 1.5B", role: "lead_reviewer", provider: "opencode", model: "ollama/qwen2.5:1.5b", enabled: true },
    ],
  },
  "user",
  "local council demo",
);

const ev: CouncilEvidence = {
  symbol: "PEPE", state: "DECISION_READY", coverage: 82, convictionTier: "HIGH",
  bullCount: 5, bearCount: 1,
  bullPoints: ["Smart wallet cluster entered", "Organic buying", "RugCheck safety clean", "Buyer velocity rising", "Similar to 1 historical winner"],
  bearPoints: ["Thin liquidity"],
  clusterDetected: true, smartMoney: true, devSold: false, rugMatch: false, marketRegime: "ACCUMULATION", similarWinners: 1,
};

const roster = svc.settings.get("councilMembers").filter((m) => m.enabled && m.model.startsWith("ollama/"));
const base = svc.settings.get("ollamaBaseUrl");
const members: CouncilMemberResult[] = [];
const now = Date.now();
for (const m of roster) {
  const t0 = Date.now();
  const v = await ollamaReview(ev, { baseUrl: base, model: m.model, role: m.role, timeoutMs: 150000 });
  // eslint-disable-next-line no-console
  console.log(`${m.label} (${m.role}) → ${v ? v.recommendation + " " + v.score : "skip (model not pulled?)"}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (v) {
    members.push({ ...v, id: m.id, label: m.label, role: m.role as CouncilRole, model: m.model, ask: ROLE_PROMPT[m.role as CouncilRole], ms: Date.now() - t0 });
    svc.council.record({ at: now, mint: MINT, symbol: "PEPE", memberId: m.id, label: m.label, role: m.role, model: m.model, score: v.score, recommendation: v.recommendation, rationale: v.rationale });
  }
}

const consensus = buildConsensus(members, ev, svc.council.weights());
const council = consensus ? { score: consensus.score, recommendation: consensus.recommendation, rationale: consensus.rationale } : undefined;

const decision: Decision = {
  mint: MINT, symbol: "PEPE", name: "Pepe (local demo)", verdict: "BUY_SMALL", conviction: 74,
  scores: { ...emptyScores(), safety: 86, organic: 72, momentum: 68, smartMoney: 62 },
  reasons: ev.bullPoints, flags: [], caps: [], at: now,
  state: "DECISION_READY", coverage: 82, convictionTier: "HIGH", evidenceCount: 6, bullCount: 5, bearCount: 1,
};
svc.signals.insert(decision, 0.012);

(svc.aiComputer as unknown as { results: Map<string, unknown> }).results.set("local_demo", {
  taskId: "local_demo", mint: MINT, at: now, council, members, consensus,
  councilEvidence: ev, evidenceText: buildEvidencePrompt(ev), evidence: [],
});

const { url } = await startServer(svc);
// eslint-disable-next-line no-console
console.log(`LOCAL COUNCIL DASHBOARD → ${url} | ${members.length} live seat(s), consensus ${consensus ? consensus.recommendation + " " + consensus.score : "none"}`);
