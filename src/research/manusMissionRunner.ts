import type { Services } from "../services.js";
import type { MissionResult } from "../store/repositories/missionRepo.js";
import { ManusClient, latestAgentStatus, extractStructuredResult, extractErrorMessage } from "./manusClient.js";
import { composeMissionForMint } from "./composeMission.js";
import { missionToPrompt, MANUS_RECOMMENDATION_SCHEMA } from "./missionPrompt.js";
import { resultToRecord } from "./missionResult.js";
import { metrics } from "../util/metrics.js";
import { log } from "../util/logger.js";

// Project Hermes — automated Manus pipeline. Dispatches missions to the Manus
// API (task.create with our structured-output contract), polls task.listMessages
// in the background, and applies finished recommendations through the SAME
// advisory path as the operator board: injectResult → rescoreWithAttention →
// decide() (safety gate FIRST). Manus deep research takes minutes, so it NEVER
// sits in the hot Athena research queue — the readiness gate stays fast/local;
// Manus refines coins asynchronously. Every step lands in the missions table
// (audit trail: prompt = mission_json + rendered, task id/url, result, errors).

export interface ManusRunnerOpts {
  fetchFn?: typeof fetch;
  now?: () => number;
}

export class ManusMissionRunner {
  private timer?: NodeJS.Timeout;
  private polling = false;
  private readonly now: () => number;

  constructor(
    private readonly svc: Services,
    private readonly opts: ManusRunnerOpts = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** True when an API key is configured — otherwise the board stays manual. */
  available(): boolean {
    return this.svc.settings.get("manusApiKey").length > 0;
  }

  private client(): ManusClient {
    return new ManusClient({
      baseUrl: this.svc.settings.get("manusBaseUrl"),
      apiKey: this.svc.settings.get("manusApiKey"),
      fetchFn: this.opts.fetchFn,
    });
  }

  start(): void {
    const tick = () => void this.pollOnce().catch((e) => log.warn(`manus poll failed: ${(e as Error).message}`));
    this.timer = setInterval(tick, this.svc.settings.get("manusPollSec") * 1000);
    log.ok("manus mission runner started (async dispatch + poll; advisory-only)");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Dispatch an OPEN mission to the Manus API. Returns the task URL for "watch live". */
  async sendMission(missionId: number, trigger: "operator" | "auto"): Promise<{ ok: boolean; taskUrl?: string; error?: string }> {
    const row = this.svc.missions.get(missionId);
    if (!row) return { ok: false, error: "mission not found" };
    if (row.status !== "open") return { ok: false, error: `mission is ${row.status}, not open` };
    if (!this.available()) return { ok: false, error: "no Manus API key configured" };
    if (trigger === "auto") {
      const cap = this.svc.settings.get("manusMaxPerHour");
      const sentLastHour = this.svc.missions.countSentSince(this.now() - 60 * 60_000);
      if (sentLastHour >= cap) return { ok: false, error: `auto-mission hourly cap reached (${cap})` };
    }
    try {
      const created = await this.client().createTask({
        prompt: missionToPrompt(row.mission),
        title: `Coin AI mission #${missionId} $${row.symbol ?? row.mint.slice(0, 6)}`,
        agentProfile: this.svc.settings.get("manusAgentProfile"),
        schema: MANUS_RECOMMENDATION_SCHEMA,
      });
      this.svc.missions.setSent(missionId, created.taskId, created.taskUrl, this.now());
      metrics.inc("manus_task_created");
      log.info(`manus: mission #${missionId} $${row.symbol ?? row.mint.slice(0, 6)} → task ${created.taskId} (${trigger})`);
      return { ok: true, taskUrl: created.taskUrl };
    } catch (e) {
      const msg = (e as Error).message;
      metrics.inc("manus_task_create_failed");
      log.warn(`manus: dispatch of mission #${missionId} failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /** Auto-mission on a fresh paper BUY (off by default; hourly-capped; deduped per mint). */
  async autoMissionForBuy(mint: string, symbol?: string): Promise<void> {
    if (!this.available() || !this.svc.settings.get("manusAutoMissions")) return;
    const existing = this.svc.missions.forMint(mint, 5);
    if (existing.some((m) => m.status === "open" || m.status === "sent")) return; // already in flight
    const mission = composeMissionForMint(this.svc, mint, this.now());
    if (!mission) return;
    const id = this.svc.missions.insert(mission);
    const r = await this.sendMission(id, "auto");
    if (!r.ok) log.info(`manus: auto-mission for $${symbol ?? mint.slice(0, 6)} not sent: ${r.error}`);
  }

  /** Poll every SENT mission; apply finished results through the advisory path. */
  async pollOnce(): Promise<void> {
    if (this.polling || !this.available()) return; // never overlap ticks
    this.polling = true;
    try {
      const sent = this.svc.missions.sentMissions();
      if (!sent.length) return;
      const client = this.client();
      const timeoutMs = this.svc.settings.get("manusTimeoutMin") * 60_000;
      for (const m of sent) {
        if (!m.externalId) continue;
        try {
          const events = await client.listMessages(m.externalId);
          const status = latestAgentStatus(events);
          if (status === "stopped") {
            const sr = extractStructuredResult(events);
            if (sr?.success && sr.value && typeof sr.value === "object") {
              this.applyResult(m.id, m.mint, m.symbol, sr.value as Record<string, unknown>);
            } else {
              this.svc.missions.markFailed(m.id, `task stopped without structured output${sr?.error ? `: ${sr.error}` : ""} (events: ${JSON.stringify(events).slice(0, 300)})`, this.now());
              metrics.inc("manus_task_failed");
            }
          } else if (status === "error") {
            this.svc.missions.markFailed(m.id, extractErrorMessage(events) ?? "Manus reported agent_status=error", this.now());
            metrics.inc("manus_task_failed");
          } else if ((m.sentAt ?? m.createdAt) + timeoutMs < this.now()) {
            this.svc.missions.markFailed(m.id, `timed out after ${this.svc.settings.get("manusTimeoutMin")}min (last status: ${status ?? "unknown"})`, this.now());
            metrics.inc("manus_task_timeout");
          }
          // running/waiting within the timeout window → keep polling.
        } catch (e) {
          log.warn(`manus: poll of mission #${m.id} failed: ${(e as Error).message}`); // transient — retry next tick
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /** Map the structured value → MissionResult → the SAME advisory path as a paste. */
  private applyResult(missionId: number, mint: string, symbol: string | undefined, value: Record<string, unknown>): void {
    const rec = String(value.recommendation ?? "");
    const recommendation = (["confirm", "caution", "unsure", "avoid"].includes(rec) ? rec : "unsure") as MissionResult["recommendation"];
    const result: MissionResult = {
      recommendation,
      confidence: typeof value.confidence === "number" && Number.isFinite(value.confidence) ? value.confidence : 50,
      scores: typeof value.scores === "object" && value.scores ? (value.scores as MissionResult["scores"]) : undefined,
      narrative: typeof value.narrative === "string" ? value.narrative : undefined,
      reasons: [
        ...(Array.isArray(value.reasons) ? value.reasons.map(String) : []),
        ...(typeof value.bullCase === "string" && value.bullCase ? [`bull: ${value.bullCase}`] : []),
        ...(typeof value.bearCase === "string" && value.bearCase ? [`bear: ${value.bearCase}`] : []),
      ].slice(0, 10),
      provider: "manus",
    };
    const now = this.now();
    this.svc.missions.setResult(missionId, result, now);
    // resultToRecord CLAMPS all scores to domain before they touch the engine.
    this.svc.attention?.injectResult(resultToRecord(mint, symbol, result, now));
    metrics.inc("manus_task_resolved");
    log.ok(`manus: mission #${missionId} $${symbol ?? mint.slice(0, 6)} resolved → ${recommendation} (conf ${Math.round(result.confidence)})`);
  }
}
