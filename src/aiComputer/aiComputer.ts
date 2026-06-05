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
import { OpencodeServer } from "./opencodeServer.js";
import { buildEvidencePrompt, type CouncilEvidence, type CouncilMemberResult, type CouncilVerdict } from "./councilShared.js";
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
  evidence: Array<{ url: string; ok: boolean; reason: string; screenshotPath?: string }>;
}

export class AiComputer {
  readonly audit: AuditLog;
  readonly approvals = new ApprovalQueue();
  private readonly queue = new TaskQueue();
  private readonly results = new Map<string, AiComputerResult>();
  private readonly opencode = new OpencodeServer();
  private counter = 0;

  constructor(
    db: DB,
    private readonly settings: SettingsStore,
    private readonly tokens: TokensRepo,
    private readonly ctx: CouncilContext,
    private readonly councilJournal: CouncilRepo,
  ) {
    this.audit = new AuditLog(db);
  }

  /** Enqueue a background research task; returns its id immediately. */
  research(mint: string): string {
    const taskId = `ai_${mint.slice(0, 6)}_${Date.now().toString(36)}_${this.counter++}`;
    this.queue.enqueue(() => this.run(taskId, mint));
    return taskId;
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

  private async run(taskId: string, mint: string): Promise<void> {
    // 1. Read-only browser evidence (audited screenshots) — unchanged.
    const pages: AiComputerResult["evidence"] = [];
    const urls = [
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
    const roster = this.activeRoster();
    const needsOpencode = roster.some((m) => m.provider === "opencode");
    const baseUrl = needsOpencode
      ? await this.opencode.ensure({
          enabled: this.settings.get("opencodeEnabled"),
          autoServe: this.settings.get("opencodeAutoServe"),
          port: this.settings.get("opencodePort"),
          bin: this.settings.get("opencodeBin"),
        })
      : undefined;

    const settled = await Promise.allSettled(roster.map((m) => this.runMember(m, evidence, baseUrl)));
    const members = settled
      .map((r) => (r.status === "fulfilled" ? r.value : undefined))
      .filter((x): x is CouncilMemberResult => !!x);

    const consensus = buildConsensus(members, evidence, this.councilJournal.weights());
    const council: CouncilVerdict | undefined = consensus
      ? { score: consensus.score, recommendation: consensus.recommendation, rationale: consensus.rationale }
      : undefined;

    // 3. Journal every seat's opinion for accuracy tracking (resolved later).
    const now = Date.now();
    for (const m of members) {
      this.councilJournal.record({
        at: now, mint, symbol: evidence.symbol, memberId: m.id, label: m.label,
        role: m.role, model: m.model, score: m.score, recommendation: m.recommendation, rationale: m.rationale,
      });
    }

    this.results.set(taskId, {
      taskId, mint, at: now, council, members, consensus,
      councilEvidence: evidence, evidenceText: buildEvidencePrompt(evidence), evidence: pages,
    });
    log.info(`ai-computer: council done for ${mint.slice(0, 8)} — ${members.length} seat(s), consensus ${consensus ? consensus.recommendation + " " + consensus.score : "none"}`);
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
