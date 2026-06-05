/**
 * Verification harness (NOT shipped in the engine): seeds a handful of realistic
 * scored tokens into the journal + the in-memory graph-intelligence map, then
 * starts ONLY the dashboard server so the operator console can be screenshotted
 * with fully-populated panels. Run: `tsx scripts/seed-and-serve.ts`.
 */
import { createServices } from "../src/services.js";
import { startServer } from "../src/dashboard/server.js";
import { computeGraphIntelligence } from "../src/graph/graphIntelligence.js";
import { buildConsensus } from "../src/council/consensus.js";
import { evidenceFromIntel } from "../src/council/evidence.js";
import type { CouncilMemberResult } from "../src/aiComputer/councilShared.js";
import { emptyScores, type Decision, type SafetyResult, type ScoreBreakdown, type Verdict } from "../src/types.js";

const now = Date.now();

function safety(pass: boolean, unknownCount = 0): SafetyResult {
  return {
    pass,
    stage: 1,
    checks: [{ id: "rugcheckRisk", status: pass ? "PASS" : "FAIL", fatal: true, label: "RugCheck" }],
    unknownCount,
    fatalReasons: pass ? [] : ["honeypot"],
    score: pass ? 85 : 10,
  };
}

interface Scenario {
  symbol: string;
  verdict: Verdict;
  conviction: number;
  scores: Partial<ScoreBreakdown>;
  ageMs: number;
  liquidityUsd?: number;
  tradeCount: number;
  devSold?: boolean;
  bundle?: boolean;
  rugMatch?: boolean;
  similarWinners?: number;
  safetyPass?: boolean;
}

const SCENARIOS: Scenario[] = [
  { symbol: "PEPE", verdict: "BUY_STRONG", conviction: 82, scores: { safety: 88, organic: 74, momentum: 70, smartMoney: 62, graduation: 56, hype: 64 }, ageMs: 64_000, liquidityUsd: 18_000, tradeCount: 26, similarWinners: 1 },
  { symbol: "WIF2", verdict: "BUY_SMALL", conviction: 58, scores: { safety: 78, organic: 61, momentum: 60, smartMoney: 50, hype: 52 }, ageMs: 48_000, liquidityUsd: 7_500, tradeCount: 14 },
  { symbol: "MOON", verdict: "WATCH_ONLY", conviction: 47, scores: { safety: 70, organic: 52, momentum: 46, hype: 44 }, ageMs: 33_000, liquidityUsd: 4_200, tradeCount: 10 },
  { symbol: "CHAD", verdict: "WATCH_ONLY", conviction: 41, scores: { safety: 55, organic: 48 }, ageMs: 21_000, tradeCount: 3 },
  { symbol: "LATE", verdict: "TOO_LATE", conviction: 38, scores: { safety: 72, organic: 58, momentum: 66, lateEntryRisk: 68 }, ageMs: 80_000, liquidityUsd: 22_000, tradeCount: 30 },
  { symbol: "RUGX", verdict: "AVOID", conviction: 14, scores: { safety: 35, organic: 28, momentum: 22, lateEntryRisk: 55 }, ageMs: 27_000, liquidityUsd: 1_400, tradeCount: 12, devSold: true, bundle: true, rugMatch: true, safetyPass: false },
];

function seed(svc: ReturnType<typeof createServices>): void {
  SCENARIOS.forEach((sc, idx) => {
    const mint = `Seed${sc.symbol}${"1".repeat(36)}`.slice(0, 44);
    const firstSeenAt = now - sc.ageMs;
    const scores: ScoreBreakdown = { ...emptyScores(), ...sc.scores };
    const saf = safety(sc.safetyPass ?? true, sc.symbol === "CHAD" ? 2 : 0);

    const intel = computeGraphIntelligence({
      mint, symbol: sc.symbol, creator: "Dev" + idx,
      scores, safety: saf, verdict: sc.verdict, conviction: sc.conviction,
      devSold: sc.devSold, bundle: sc.bundle, rugMatch: sc.rugMatch,
      similarWinners: sc.similarWinners ?? 0, deployerLaunches: idx === 5 ? 1 : 4,
      liquidityUsd: sc.liquidityUsd, tradeCount: sc.tradeCount, firstSeenAt, now,
    });
    svc.runtime.intel.set(mint, intel);

    const decision: Decision = {
      mint, symbol: sc.symbol, name: sc.symbol + " coin",
      verdict: sc.verdict, conviction: sc.conviction, scores,
      reasons: intel.why, flags: sc.rugMatch ? ["bundle", "dev-sold"] : [], caps: [],
      riskTier: sc.verdict === "BUY_STRONG" ? "HIGH" : sc.verdict === "BUY_SMALL" ? "MEDIUM" : "NONE",
      suggestedRiskPct: sc.verdict === "BUY_STRONG" ? 1.8 : sc.verdict === "BUY_SMALL" ? 0.9 : 0,
      marketWeather: "RISK_ON", sourceAgreement: 72,
      redFlags: sc.rugMatch ? ['name matches past rug "rugx"', "bundle / sniper cluster"] : [],
      state: intel.state, coverage: intel.coverage, convictionTier: intel.convictionTier,
      evidenceCount: intel.bull.length + intel.bear.length, bullCount: intel.bull.length, bearCount: intel.bear.length,
      at: firstSeenAt,
    };
    svc.signals.insert(decision, sc.liquidityUsd ? sc.liquidityUsd / 1e6 : undefined);
  });

  const recent = [...svc.runtime.intel.values()];
  svc.runtime.engineState = {
    observing: recent.filter((x) => x.state === "OBSERVING" || x.state === "MATURE").length + 7,
    decisionReady: recent.filter((x) => x.state === "DECISION_READY").length,
    highConviction: recent.filter((x) => x.convictionTier === "HIGH").length,
    highRisk: recent.filter((x) => x.bearScore > x.bullScore).length,
  };
}

function seedCouncil(svc: ReturnType<typeof createServices>): void {
  const pepeMint = `SeedPEPE${"1".repeat(36)}`.slice(0, 44);
  const intel = svc.runtime.intel.get(pepeMint);
  const members: CouncilMemberResult[] = [
    { id: "claude", label: "Claude", role: "bull_analyst", score: 78, recommendation: "confirm", rationale: "Smart-money cluster + organic buying — a real bull case, not just hype.", ms: 1180 },
    { id: "gpt4o", label: "GPT-4o", role: "narrative_analyst", model: "openai/gpt-4o", score: 64, recommendation: "confirm", rationale: "Narrative is fresh though derivative; momentum is carrying it for now.", ms: 2090 },
    { id: "deepseek", label: "DeepSeek", role: "risk_analyst", model: "deepseek/deepseek-chat", score: 57, recommendation: "caution", rationale: "Liquidity adequate but young; deployer still holds a large share.", ms: 1840 },
    { id: "qwen", label: "Qwen", role: "contrarian", model: "qwen/qwen-max", score: 51, recommendation: "caution", rationale: "Cluster confidence may be overstated; float is thin enough to reverse fast.", ms: 1660 },
  ];
  const evidence = intel ? evidenceFromIntel(intel, "ACCUMULATION") : undefined;
  const consensus = evidence ? buildConsensus(members, evidence) : undefined;
  const council = consensus ? { score: consensus.score, recommendation: consensus.recommendation, rationale: consensus.rationale } : undefined;
  // Dev-only injection of a completed council result (the results map is private).
  (svc.aiComputer as unknown as { results: Map<string, unknown> }).results.set("seed_demo", {
    taskId: "seed_demo", mint: pepeMint, at: now, council, members, consensus, evidence: [],
  });

  // Journal history → per-seat accuracy + bounded dynamic weights.
  const defs: Array<[string, string, string, number]> = [
    ["claude", "Claude", "bull_analyst", 0.78],
    ["gpt4o", "GPT-4o", "narrative_analyst", 0.62],
    ["deepseek", "DeepSeek", "risk_analyst", 0.71],
    ["qwen", "Qwen", "contrarian", 0.55],
  ];
  for (let i = 0; i < 12; i++) {
    const mint = `Hist${i}${"x".repeat(40)}`.slice(0, 44);
    const win = Math.random() < 0.4;
    for (const [id, label, role, acc] of defs) {
      const correct = Math.random() < acc;
      const rec: "confirm" | "caution" = win === correct ? "confirm" : "caution";
      svc.council.record({
        at: now - (12 - i) * 3_600_000, mint, symbol: `H${i}`, memberId: id, label, role, model: "",
        score: rec === "confirm" ? 60 + Math.floor(Math.random() * 25) : 30 + Math.floor(Math.random() * 20),
        recommendation: rec, rationale: "historical opinion",
      });
    }
    svc.council.resolve(mint, win ? "win" : "loss", win ? 160 : 18);
  }
}

async function mainSeed(): Promise<void> {
  const svc = createServices();
  seed(svc);
  seedCouncil(svc);
  const { url } = await startServer(svc);
  // eslint-disable-next-line no-console
  console.log(`SEEDED DASHBOARD → ${url}`);
}

void mainSeed();
