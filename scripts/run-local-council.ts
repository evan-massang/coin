/**
 * Runs the REAL local council (whichever Ollama models are pulled) on one token —
 * opening takes + a debate round — then serves the dashboard so the Council Room
 * chat shows genuine local-model back-and-forth. Seats whose model isn't pulled
 * drop out. Run isolated:  DATA_DIR=./.verify-data PORT=3014 NO_OPEN=1 tsx scripts/run-local-council.ts
 */
import { createServices } from "../src/services.js";
import { startServer } from "../src/dashboard/server.js";
import { ollamaReview, ollamaChat } from "../src/aiComputer/ollamaCouncil.js";
import { buildConsensus } from "../src/council/consensus.js";
import { buildEvidencePrompt, buildDebateSystemPrompt, buildDebatePrompt, parseDebate, type CouncilEvidence, type CouncilMemberResult, type CouncilMessage } from "../src/aiComputer/councilShared.js";
import { ROLE_PROMPT, type CouncilRole } from "../src/council/roles.js";
import { emptyScores, type Decision } from "../src/types.js";

const MINT = "PEPElocal1111111111111111111111111111111111".slice(0, 44);

const svc = createServices();
svc.settings.update(
  {
    opencodeEnabled: true, councilDebate: true, ollamaBaseUrl: "http://127.0.0.1:11434",
    councilMembers: [
      { id: "qwen", label: "Qwen 3B", role: "bull_analyst", provider: "opencode", model: "ollama/qwen2.5:3b", enabled: true },
      { id: "llama", label: "Llama 3.2", role: "narrative_analyst", provider: "opencode", model: "ollama/llama3.2:3b", enabled: true },
      { id: "gemma", label: "Gemma 2", role: "risk_analyst", provider: "opencode", model: "ollama/gemma2:2b", enabled: true },
      { id: "phi", label: "Phi 3.5", role: "contrarian", provider: "opencode", model: "ollama/phi3.5", enabled: true },
      { id: "qwen-lead", label: "Qwen 1.5B", role: "lead_reviewer", provider: "opencode", model: "ollama/qwen2.5:1.5b", enabled: true },
    ],
  },
  "user", "local council demo",
);

const ev: CouncilEvidence = {
  symbol: "PEPE", state: "DECISION_READY", coverage: 82, convictionTier: "HIGH", bullCount: 5, bearCount: 1,
  bullPoints: ["Smart wallet cluster entered", "Organic buying", "RugCheck safety clean", "Buyer velocity rising", "Similar to 1 historical winner"],
  bearPoints: ["Thin liquidity"], clusterDetected: true, smartMoney: true, devSold: false, rugMatch: false, marketRegime: "ACCUMULATION", similarWinners: 1,
};

const roster = svc.settings.get("councilMembers").filter((m) => m.enabled && m.model.startsWith("ollama/"));
const base = svc.settings.get("ollamaBaseUrl");
const members: CouncilMemberResult[] = [];
const transcript: CouncilMessage[] = [];
const now = Date.now();

// Round 1 — opening takes
for (const m of roster) {
  const v = await ollamaReview(ev, { baseUrl: base, model: m.model, role: m.role, timeoutMs: 150000 });
  // eslint-disable-next-line no-console
  console.log(`[r1] ${m.label} → ${v ? v.recommendation + " " + v.score : "skip (model not pulled?)"}`);
  if (!v) continue;
  members.push({ ...v, id: m.id, label: m.label, role: m.role as CouncilRole, model: m.model, ask: ROLE_PROMPT[m.role as CouncilRole], ms: 0 });
  transcript.push({ round: 1, id: m.id, label: m.label, role: m.role as CouncilRole, model: m.model, text: v.rationale, recommendation: v.recommendation, score: v.score, at: Date.now() });
}

// Round 2 — debate
if (members.length >= 2) {
  for (const m of roster) {
    const mem = members.find((x) => x.id === m.id);
    if (!mem) continue;
    const others = members.filter((x) => x.id !== m.id);
    const raw = await ollamaChat(base, m.model, buildDebateSystemPrompt(m.role as CouncilRole), buildDebatePrompt(ev, others), 120000);
    if (!raw) continue;
    const d = parseDebate(raw);
    mem.recommendation = d.recommendation; mem.score = d.score;
    // eslint-disable-next-line no-console
    console.log(`[r2] ${m.label} → ${d.recommendation} ${d.score}: ${d.text.slice(0, 70)}`);
    transcript.push({ round: 2, id: m.id, label: m.label, role: m.role as CouncilRole, model: m.model, text: d.text, recommendation: d.recommendation, score: d.score, at: Date.now() });
  }
}

for (const m of members) svc.council.record({ at: now, mint: MINT, symbol: "PEPE", memberId: m.id, label: m.label, role: m.role, model: m.model, score: m.score, recommendation: m.recommendation, rationale: m.rationale });
const consensus = buildConsensus(members, ev, svc.council.weights());
const council = consensus ? { score: consensus.score, recommendation: consensus.recommendation, rationale: consensus.rationale } : undefined;

const decision: Decision = {
  mint: MINT, symbol: "PEPE", name: "Pepe (local demo)", verdict: "BUY_SMALL", conviction: 74,
  scores: { ...emptyScores(), safety: 86, organic: 72, momentum: 68, smartMoney: 62 }, reasons: ev.bullPoints, flags: [], caps: [], at: now,
  state: "DECISION_READY", coverage: 82, convictionTier: "HIGH", evidenceCount: 6, bullCount: 5, bearCount: 1,
};
svc.signals.insert(decision, 0.012);

(svc.aiComputer as unknown as { results: Map<string, unknown> }).results.set("local_demo", {
  taskId: "local_demo", mint: MINT, at: now, council, members, consensus, transcript,
  councilEvidence: ev, evidenceText: buildEvidencePrompt(ev), evidence: [],
});

const { url } = await startServer(svc);
// eslint-disable-next-line no-console
console.log(`LOCAL COUNCIL DASHBOARD → ${url} | ${members.length} seats, ${transcript.length} msgs, consensus ${consensus ? consensus.recommendation + " " + consensus.score : "none"}`);
