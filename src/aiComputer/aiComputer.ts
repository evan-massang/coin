import type { DB } from "../store/db.js";
import type { SettingsStore } from "../store/settingsStore.js";
import type { TokensRepo } from "../store/repositories/tokensRepo.js";
import type { CouncilRepo } from "../store/repositories/councilRepo.js";
import type { GraphIntel } from "../types.js";
import { TaskQueue } from "./taskQueue.js";
import { AuditLog } from "./auditLog.js";
import { ApprovalQueue } from "./humanApproval.js";
import { captureEvidence } from "./browserAgent.js";
import { saveScreenshot } from "./screenshotEvidence.js";
import { checkAction } from "./actionPolicy.js";
import { anthropicReview } from "./council.js";
import { opencodeReview } from "./opencodeCouncil.js";
import { ollamaReview, ollamaChat } from "./ollamaCouncil.js";
import { OpencodeServer } from "./opencodeServer.js";
import { buildEvidencePrompt, buildDebateSystemPrompt, buildDebatePrompt, parseDebate, type CouncilEvidence, type CouncilMemberResult, type CouncilMessage, type CouncilVerdict } from "./councilShared.js";
import { evidenceFromIntel, sparseEvidence } from "../council/evidence.js";
import { buildConsensus, type Consensus } from "../council/consensus.js";
import { ROLE_PROMPT, type CouncilMemberConfig } from "../council/roles.js";
import { log } from "../util/logger.js";

// Orchestrates a READ-ONLY research task: open the allowlisted data pages for a
// mint (headless, screenshot only, audited), then convene the AI COUNCIL — a
// panel of role-specialised seats (Claude + any models via OpenCode) that review
// the engine's pre-digested evidence and return advisory confirm/caution
// verdicts, blended into a consensus. Runs on a background queue so it NEVER
// blocks the scanner; it cannot click, connect a wallet, trade, or change a score.

/** Minimal live context the council reads (structurally satisfied by RuntimeState). */
export interface CouncilContext {
  intel: Map<string, GraphIntel>;
  marketRegime?: string;
}

export interface AiComputerResult {
  taskId: string;
  mint: string;
  at: number;
  /** Back-compat single verdict = the consensus (or undefined if no seat ran). */
  council?: CouncilVerdict;
  members?: CouncilMemberResult[];
  consensus?: Consensus;
  /** The interpreted facts put to the council (the "question") — for the room. */
  councilEvidence?: CouncilEvidence;
  /** The exact evidence text every seat received. */
  evidenceText?: string;
  /** The full chat transcript (opening takes + debate) for the Council Room. */
  transcript?: CouncilMessage[];
  evidence: Array<{ url: string; ok: boolean; reason: string; screenshotPath?: string }>;
}

/** Live Council Room event streamed to the dashboard over the websocket. */
export type CouncilEvent =
  | { kind: "question"; taskId: string; mint: string; symbol?: string; evidenceText: string; at: number }
  | { kind: "message"; taskId: string; mint: string; message: CouncilMessage }
  | { kind: "done"; taskId: string; mint: string; consensus?: Consensus; at: number };

/**
 * Pure rotation policy for the always-on debate: given live mints (oldest→newest,
 * matching the intel LRU's insertion order) and when each was last debated, return
 * the NEWEST coin that hasn't been debated within the cooldown — so fresh coins are
 * preferred but every coin gets a turn before any repeats. Exported for tests.
 */
export function pickNextDebate(
  mintsOldestFirst: string[],
  lastDebatedAt: Map<string, number>,
  now: number,
  cooldownMs: number,
): string | undefined {
  for (let i = mintsOldestFirst.length - 1; i >= 0; i--) {
    const mint = mintsOldestFirst[i]!;
    const last = lastDebatedAt.get(mint);
    if (last === undefined || now - last >= cooldownMs) return mint;
  }
  return undefined;
}

export class AiComputer {
  readonly audit: AuditLog;
  readonly approvals = new ApprovalQueue();
  private readonly queue = new TaskQueue();
  private readonly results = new Map<string, AiComputerResult>();
  private readonly opencode = new OpencodeServer();
  private counter = 0;
  // Always-on auto-debate: rotate the council through live coins, one at a time.
  private autoTimer?: NodeJS.Timeout;
  private readonly lastDebatedAt = new Map<string, number>();

  constructor(
    db: DB,
    private readonly settings: SettingsStore,
    private readonly tokens: TokensRepo,
    private readonly ctx: CouncilContext,
    private readonly councilJournal: CouncilRepo,
    /** Live Council Room stream (websocket). Optional. */
    private readonly broadcast?: (event: CouncilEvent) => void,
  ) {
    this.audit = new AuditLog(db);
  }

  /** Enqueue a background research task; returns its id immediately. */
  research(mint: string, opts: { skipBrowser?: boolean } = {}): string {
    const taskId = `ai_${mint.slice(0, 6)}_${Date.now().toString(36)}_${this.counter++}`;
    this.queue.enqueue(() => this.run(taskId, mint, opts.skipBrowser ?? false));
    return taskId;
  }

  /**
   * Always-on Council Room: continuously debate the live coins. While enabled,
   * whenever the council queue is idle we pick the most-recently-observed coin
   * that hasn't been debated within the cooldown and convene the panel on it —
   * so the room is never idle and the user never has to trigger a debate. Browser
   * screenshots are skipped on auto runs (they're an AI-Computer audit feature,
   * not needed for the debate, and would hammer Playwright).
   */
  startAutoDebate(opts: { intervalMs?: number; cooldownMs?: number } = {}): void {
    const intervalMs = opts.intervalMs ?? 6_000;
    const cooldownMs = opts.cooldownMs ?? 12 * 60_000;
    if (this.autoTimer) return;
    this.autoTimer = setInterval(() => {
      if (!this.settings.get("councilAutoDebate")) return;
      if (!this.queue.idle) return; // a debate is still running — keep it one-at-a-time
      if (this.activeRoster().length === 0) return; // no seats enabled → nothing to run
      const mint = this.pickAutoCandidate(cooldownMs);
      if (!mint) return;
      this.lastDebatedAt.set(mint, Date.now());
      this.research(mint, { skipBrowser: true });
    }, intervalMs);
    log.ok("council auto-debate started (always-on; rotates through live coins)");
  }

  stopAutoDebate(): void {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.autoTimer = undefined;
  }

  /** Newest observed coin not debated within the cooldown (rotates the stream). */
  private pickAutoCandidate(cooldownMs: number): string | undefined {
    // ctx.intel is an insertion-ordered LRU (oldest → newest).
    return pickNextDebate([...this.ctx.intel.keys()], this.lastDebatedAt, Date.now(), cooldownMs);
  }

  getResult(taskId: string): AiComputerResult | undefined {
    return this.results.get(taskId);
  }

  /** Most recent completed research result (for the dashboard Council Room). */
  latest(): AiComputerResult | undefined {
    let best: AiComputerResult | undefined;
    for (const r of this.results.values()) if (!best || r.at > best.at) best = r;
    return best;
  }

  get queueSize(): number {
    return this.queue.size;
  }

  /** Kill the auto-spawned OpenCode server (if any) on shutdown. */
  shutdownOpencode(): void {
    this.opencode.stop();
  }

  private async run(taskId: string, mint: string, skipBrowser = false): Promise<void> {
    // 1. Read-only browser evidence (audited screenshots). Skipped on always-on
    //    auto runs — it's an AI-Computer audit feature, not needed for the debate.
    const pages: AiComputerResult["evidence"] = [];
    const urls = skipBrowser
      ? []
      : [
          `https://rugcheck.xyz/tokens/${mint}`,
          `https://dexscreener.com/solana/${mint}`,
          `https://solscan.io/token/${mint}`,
        ];
    for (const url of urls) {
      const decision = checkAction({ type: "navigate", url });
      const cap = decision.allowed ? await captureEvidence(url) : { available: true, error: decision.reason };
      const screenshotPath = saveScreenshot(taskId, hostOf(url), cap.screenshot);
      const ok = decision.allowed && !cap.error;
      const reason = cap.error ?? decision.reason;
      this.audit.record({ at: Date.now(), taskId, actionType: "navigate", url, allowed: ok, reason, screenshotPath });
      pages.push({ url, ok, reason, screenshotPath });
    }

    // 2. Convene the council over the engine's interpreted evidence (not raw data).
    const evidence = this.councilEvidence(mint);
    // DATA-SUFFICIENCY GATE (operator teardown: 100% of inputs said "insufficient
    // data" and five seats dutifully answered "dunno, 50" 5,543 times). No AI runs
    // on a coin the engine itself hasn't materially observed: require real data
    // coverage and at least some evidence to weigh. Saves the compute AND the noise.
    const sufficient = (evidence.coverage ?? 0) >= 50 && evidence.bullCount + evidence.bearCount >= 2;
    if (!sufficient) {
      this.results.set(taskId, {
        taskId, mint, at: Date.now(), evidence: pages,
        councilEvidence: evidence, evidenceText: buildEvidencePrompt(evidence), transcript: [],
      });
      log.info(`ai-computer: council skipped for ${mint.slice(0, 8)} — insufficient data (coverage ${evidence.coverage ?? 0}%, evidence ${evidence.bullCount + evidence.bearCount})`);
      return;
    }
    const roster = this.activeRoster();
    // Local `ollama/*` seats talk to Ollama directly — only remote seats need OpenCode.
    const needsOpencode = roster.some((m) => m.provider === "opencode" && !m.model.startsWith("ollama/"));
    const baseUrl = needsOpencode
      ? await this.opencode.ensure({
          enabled: this.settings.get("opencodeEnabled"),
          autoServe: this.settings.get("opencodeAutoServe"),
          port: this.settings.get("opencodePort"),
          bin: this.settings.get("opencodeBin"),
        })
      : undefined;

    // Open the room: post the question (live).
    this.broadcast?.({ kind: "question", taskId, mint, symbol: evidence.symbol, evidenceText: buildEvidencePrompt(evidence), at: Date.now() });

    const transcript: CouncilMessage[] = [];
    const members: CouncilMemberResult[] = [];
    const post = (msg: CouncilMessage) => { transcript.push(msg); this.broadcast?.({ kind: "message", taskId, mint, message: msg }); };

    // Round 1 — opening takes. Sequential: local CPU models serialize through
    // Ollama anyway, and one-at-a-time means a slow seat can't time out the queue.
    for (const m of roster) {
      const r = await this.runMember(m, evidence, baseUrl).catch(() => undefined);
      if (!r) continue;
      members.push(r);
      post({ round: 1, id: r.id, label: r.label, role: r.role, model: r.model, text: r.rationale, recommendation: r.recommendation, score: r.score, at: Date.now() });
    }

    // Round 2 — debate. Local seats react to the panel and may move their call.
    if (this.settings.get("councilDebate") && members.length >= 2) {
      const ollamaBase = this.settings.get("ollamaBaseUrl");
      for (const m of roster) {
        if (!(m.provider === "opencode" && m.model.startsWith("ollama/"))) continue;
        const mem = members.find((x) => x.id === m.id);
        if (!mem) continue;
        const others = members.filter((x) => x.id !== m.id);
        const raw = await ollamaChat(ollamaBase, m.model, buildDebateSystemPrompt(m.role), buildDebatePrompt(evidence, others), 150000).catch(() => undefined);
        if (!raw) continue;
        const d = parseDebate(raw);
        mem.recommendation = d.recommendation; // debate is the seat's FINAL stance
        mem.score = d.score;
        post({ round: 2, id: m.id, label: mem.label, role: m.role, model: m.model, text: d.text, recommendation: d.recommendation, score: d.score, at: Date.now() });
      }
    }

    const consensus = buildConsensus(members, evidence, this.councilJournal.weights());
    const council: CouncilVerdict | undefined = consensus
      ? { score: consensus.score, recommendation: consensus.recommendation, rationale: consensus.rationale }
      : undefined;

    // Journal each seat's FINAL opinion for accuracy tracking (resolved later).
    const now = Date.now();
    for (const m of members) {
      this.councilJournal.record({
        at: now, mint, symbol: evidence.symbol, memberId: m.id, label: m.label,
        role: m.role, model: m.model, score: m.score, recommendation: m.recommendation, rationale: m.rationale,
      });
    }

    this.results.set(taskId, {
      taskId, mint, at: now, council, members, consensus, transcript,
      councilEvidence: evidence, evidenceText: buildEvidencePrompt(evidence), evidence: pages,
    });
    this.broadcast?.({ kind: "done", taskId, mint, consensus, at: now });
    log.info(`ai-computer: council done for ${mint.slice(0, 8)} — ${members.length} seat(s), ${transcript.length} msg(s), consensus ${consensus ? consensus.recommendation + " " + consensus.score : "none"}`);
  }

  /** Seats that should run now: enabled + their provider is available. */
  private activeRoster(): CouncilMemberConfig[] {
    const s = this.settings.all();
    return s.councilMembers.filter((m) =>
      m.enabled && (m.provider === "anthropic" ? !!s.anthropicApiKey : s.opencodeEnabled),
    );
  }

  private councilEvidence(mint: string): CouncilEvidence {
    const intel = this.ctx.intel.get(mint);
    if (intel) return evidenceFromIntel(intel, this.ctx.marketRegime);
    return sparseEvidence(this.tokens.get(mint)?.symbol, this.ctx.marketRegime);
  }

  private async runMember(m: CouncilMemberConfig, evidence: CouncilEvidence, baseUrl?: string): Promise<CouncilMemberResult | undefined> {
    const t0 = Date.now();
    let v: CouncilVerdict | undefined;
    if (m.provider === "anthropic") {
      v = await anthropicReview(evidence, { apiKey: this.settings.get("anthropicApiKey") || undefined, role: m.role, model: m.model || undefined });
    } else if (m.provider === "opencode" && m.model.startsWith("ollama/")) {
      v = await ollamaReview(evidence, { baseUrl: this.settings.get("ollamaBaseUrl"), model: m.model, role: m.role });
    } else if (m.provider === "opencode" && baseUrl) {
      v = await opencodeReview(evidence, { baseUrl, model: m.model || this.settings.get("opencodeModel"), role: m.role });
    }
    if (!v) return undefined;
    return { ...v, id: m.id, label: m.label, role: m.role, model: m.model || undefined, ask: ROLE_PROMPT[m.role], ms: Date.now() - t0 };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "x";
  }
}
