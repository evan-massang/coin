import type { DB } from "../store/db.js";
import type { SettingsStore } from "../store/settingsStore.js";
import type { RugcheckCache } from "../sources/rugcheckCache.js";
import type { TokensRepo } from "../store/repositories/tokensRepo.js";
import { TaskQueue } from "./taskQueue.js";
import { AuditLog } from "./auditLog.js";
import { ApprovalQueue } from "./humanApproval.js";
import { captureEvidence } from "./browserAgent.js";
import { saveScreenshot } from "./screenshotEvidence.js";
import { councilReview, type CouncilVerdict } from "./council.js";
import { checkAction } from "./actionPolicy.js";
import { log } from "../util/logger.js";

// Orchestrates a READ-ONLY research task: open the allowlisted data pages for a
// mint (headless, screenshot only), audit every action, then ask the council
// for an evidence-only second opinion. Runs on a background queue so it NEVER
// blocks the scanner. It cannot click, connect a wallet, or trade.

export interface AiComputerResult {
  taskId: string;
  mint: string;
  at: number;
  council?: CouncilVerdict;
  evidence: Array<{ url: string; ok: boolean; reason: string; screenshotPath?: string }>;
}

export class AiComputer {
  readonly audit: AuditLog;
  readonly approvals = new ApprovalQueue();
  private readonly queue = new TaskQueue();
  private readonly results = new Map<string, AiComputerResult>();
  private counter = 0;

  constructor(
    db: DB,
    private readonly settings: SettingsStore,
    private readonly rugcheck: RugcheckCache,
    private readonly tokens: TokensRepo,
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

  /** Most recent completed research result (for the dashboard council panel). */
  latest(): AiComputerResult | undefined {
    let best: AiComputerResult | undefined;
    for (const r of this.results.values()) if (!best || r.at > best.at) best = r;
    return best;
  }

  get queueSize(): number {
    return this.queue.size;
  }

  private async run(taskId: string, mint: string): Promise<void> {
    const evidence: AiComputerResult["evidence"] = [];
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
      evidence.push({ url, ok, reason, screenshotPath });
    }

    // Build evidence text from facts the engine already has (no scraping needed).
    const report = await this.rugcheck.getReport(mint, { apiKey: this.settings.get("rugcheckApiKey") || undefined }).catch(() => undefined);
    const meta = this.tokens.get(mint);
    const evidenceText = [
      `mint: ${mint}`,
      `name/symbol: ${meta?.name ?? "?"} / ${meta?.symbol ?? "?"}`,
      report
        ? `rugcheck: risk=${report.riskLevel} honeypot=${report.honeypot} topHolder=${report.topHolderPct ?? "?"}% liquidity=$${Math.round(report.totalLiquidityUsd ?? 0)} lpLocked=${report.lpLockedPct ?? "?"}%`
        : "rugcheck: (no data)",
    ].join("\n");

    const council = await councilReview(evidenceText, this.settings.get("anthropicApiKey") || undefined);
    this.results.set(taskId, { taskId, mint, at: Date.now(), council, evidence });
    log.info(`ai-computer: research done for ${mint.slice(0, 8)} (${council ? council.recommendation : "council off"})`);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "x";
  }
}
