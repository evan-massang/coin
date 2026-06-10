import type { Services } from "../services.js";
import type { Mission } from "./mission.types.js";
import type { MissionResult, MissionRow } from "../store/repositories/missionRepo.js";
import { ManusClient, latestAgentStatus, extractStructuredResult, extractErrorMessage, extractChatItems, extractAssistantTexts, type ChatItem } from "./manusClient.js";
import { composeMissionForMint } from "./composeMission.js";
import { missionToPrompt, MANUS_RECOMMENDATION_SCHEMA } from "./missionPrompt.js";
import { discoveryPrompt, deepdivePrompt, DISCOVERY_SCHEMA, DEEPDIVE_SCHEMA, type DiscoverySeed } from "./discoveryPrompt.js";
import { resultToRecord } from "./missionResult.js";
import { isValidSolanaAddress } from "../sources/solanaRpc.js";
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
  /** Auto-nudge bookkeeping: missionId → "continue" messages sent (capped). */
  private readonly nudges = new Map<number, number>();

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

  /** Hermes Phase 3 — dispatch a DISCOVERY mission: Manus hunts candidates itself
   *  with the operator's playbook; resolution injects every valid mint into the
   *  local pipeline for verification + monitoring. */
  async dispatchDiscovery(trigger: "operator" | "auto"): Promise<{ ok: boolean; id?: number; taskUrl?: string; error?: string }> {
    if (!this.available()) return { ok: false, error: "no Manus API key configured" };
    if (this.svc.missions.hasActiveOfKind("discovery")) return { ok: false, error: "a discovery mission is already in flight" };
    const n = this.svc.settings.get("manusDiscoveryCandidates");
    const now = this.now();
    const seeds = this.discoverySeeds(now);
    const prompt = discoveryPrompt(n, seeds);
    const mission = pseudoMission("discovery", "SCAN", `Discovery: hunt the top ${n} Solana meme candidates ($50k-500k mcap, hard rug filter, real humans, pre-influencer). Seeded with ${seeds.length} live local candidates.`, now);
    mission.renderedPrompt = prompt; // Phase 8: the EXACT dispatched prompt is stored
    const id = this.svc.missions.insert(mission, "discovery");
    try {
      const created = await this.client().createTask({
        prompt,
        title: `Coin AI discovery #${id} — hunt ${n} candidates`,
        agentProfile: this.svc.settings.get("manusAgentProfile"),
        schema: DISCOVERY_SCHEMA,
      });
      this.svc.missions.setSent(id, created.taskId, created.taskUrl, now);
      metrics.inc("manus_discovery_created");
      log.ok(`manus: discovery #${id} dispatched (${trigger}) → ${created.taskUrl ?? created.taskId}`);
      return { ok: true, id, taskUrl: created.taskUrl };
    } catch (e) {
      this.svc.missions.markFailed(id, (e as Error).message, this.now());
      return { ok: false, id, error: (e as Error).message };
    }
  }

  /** Live chat transcript for a mission's Manus task (Hermes Phase 7 — the
   *  operator watches what Manus is actually saying, in the dashboard). */
  async getChat(missionId: number): Promise<{ ok: boolean; status?: string; items?: ChatItem[]; error?: string }> {
    const m = this.svc.missions.get(missionId);
    if (!m?.externalId) return { ok: false, error: "mission has no Manus task attached" };
    if (!this.available()) return { ok: false, error: "no Manus API key configured" };
    try {
      const events = await this.client().listMessages(m.externalId, 100);
      // We request order=desc (newest first) — reverse to chat order (oldest first).
      return { ok: true, status: m.status, items: extractChatItems(events).reverse() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Attach a task the operator created directly in the Manus app: a mission row
   *  in 'sent' state pointing at the external task id — the poller ingests its
   *  answer on the next tick exactly like an engine-dispatched mission. The
   *  result must still match the kind's structured-output shape; a free-text
   *  answer fails honestly ("stopped without structured output"). */
  attachExternalTask(taskId: string, kind: "discovery" | "deepdive"): { ok: boolean; id?: number; error?: string } {
    const now = this.now();
    const mission = pseudoMission(kind, "ATTACHED", `Operator-attached Manus task ${taskId} (${kind}) — answer ingested by the poller.`, now);
    const id = this.svc.missions.insert(mission, kind);
    if (!this.svc.missions.setSent(id, taskId, `https://manus.im/app/${taskId}`, now)) {
      return { ok: false, id, error: "could not mark attached mission as sent" };
    }
    log.ok(`manus: attached external task ${taskId} as mission #${id} (${kind})`);
    metrics.inc("manus_task_attached");
    return { ok: true, id };
  }

  /** Seed the hunt with the engine's OWN live shortlist — the data edge cloud
   *  agents lack (discovery #8 proved public APIs can't see hours-old micro-caps).
   *  GRADUATED COINS ONLY (Golden-Filter scanner hits or coins with a real DEX
   *  pair). Hunt #10 proved pump.fun bonding-curve newborns STRUCTURALLY fail the
   *  operator's playbook — the curve holds the mint authority and ~100% of supply,
   *  so RugCheck can never pass them; seeding them just wastes Manus's pass. */
  private discoverySeeds(now: number): DiscoverySeed[] {
    const recent = this.svc.signals.recent(200).filter(
      (s) =>
        now - s.at <= 45 * 60_000 &&
        (s.verdict === "BUY_SMALL" || s.verdict === "BUY_STRONG" || s.verdict === "WATCH_ONLY") &&
        // Graduated universe only: golden-filter scanner hit, or a real DEX pair exists.
        (s.flags.includes("src:scan") || s.pairCreatedAt != null),
    );
    const seen = new Set<string>();
    const rank = (s: (typeof recent)[number]): number => (s.verdict !== "WATCH_ONLY" ? 0 : s.flags.includes("src:scan") ? 1 : 2);
    return recent
      .sort((a, b) => rank(a) - rank(b) || b.conviction - a.conviction)
      .filter((s) => (seen.has(s.mint) ? false : (seen.add(s.mint), true)))
      .slice(0, 12)
      .map((s) => ({
        mint: s.mint,
        symbol: s.symbol,
        note: `graduated — real Raydium pool, RugCheck resolves; local engine: ${s.verdict} conviction ${s.conviction}${s.flags.includes("src:scan") ? " (golden-filter scanner)" : ""}`,
      }));
  }

  /** Batched hard-opinion review: MANY coins in ONE mission (never one-at-a-time). */
  async dispatchDeepdive(coins: Array<{ mint: string; symbol?: string; note?: string }>, trigger: "operator" | "auto"): Promise<{ ok: boolean; id?: number; taskUrl?: string; error?: string }> {
    if (!this.available()) return { ok: false, error: "no Manus API key configured" };
    if (!coins.length) return { ok: false, error: "no coins to review" };
    const now = this.now();
    const ddMission = pseudoMission("deepdive", `${coins.length} COINS`, `Deep-dive: batched hard opinion on ${coins.map((c) => `$${c.symbol ?? c.mint.slice(0, 6)}`).join(", ")}`, now);
    ddMission.renderedPrompt = deepdivePrompt(coins); // Phase 8: exact prompt stored
    const id = this.svc.missions.insert(ddMission, "deepdive");
    try {
      const created = await this.client().createTask({
        prompt: deepdivePrompt(coins),
        title: `Coin AI deep-dive #${id} — ${coins.length} coins`,
        agentProfile: this.svc.settings.get("manusAgentProfile"),
        schema: DEEPDIVE_SCHEMA,
      });
      this.svc.missions.setSent(id, created.taskId, created.taskUrl, now);
      metrics.inc("manus_deepdive_created");
      log.ok(`manus: deep-dive #${id} (${coins.length} coins) dispatched (${trigger})`);
      return { ok: true, id, taskUrl: created.taskUrl };
    } catch (e) {
      this.svc.missions.markFailed(id, (e as Error).message, this.now());
      return { ok: false, id, error: (e as Error).message };
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

  /** Poll every SENT mission; apply finished results through the advisory path.
   *  Also runs the recurring DISCOVERY cadence (Hermes Phase 3). */
  async pollOnce(): Promise<void> {
    if (this.polling || !this.available()) return; // never overlap ticks
    this.polling = true;
    try {
      // Recurring discovery: one mission in flight at a time, re-dispatched once
      // the interval has elapsed since the last one was CREATED.
      if (this.svc.settings.get("manusDiscoveryEnabled") && !this.svc.missions.hasActiveOfKind("discovery")) {
        const last = this.svc.missions.latestByKind("discovery");
        const intervalMs = this.svc.settings.get("manusDiscoveryIntervalMin") * 60_000;
        if (!last || this.now() - last.createdAt >= intervalMs) {
          await this.dispatchDiscovery("auto");
        }
      }
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
              if (m.kind === "discovery") this.applyDiscovery(m, sr.value as Record<string, unknown>);
              else if (m.kind === "deepdive") this.applyDeepdive(m, sr.value as Record<string, unknown>);
              else this.applyResult(m.id, m.mint, m.symbol, sr.value as Record<string, unknown>);
            } else if ((m.kind === "discovery" || m.kind === "deepdive") && this.applyChatText(m, events)) {
              // Unstructured-answer fallback: a task the operator ran themselves
              // (no schema attached) answers in PROSE — the result used to "just
              // sit there in the Manus chat". We read the chat text, pull the
              // Solana addresses out of it, and ingest them as candidates.
            } else {
              this.svc.missions.markFailed(m.id, `task stopped without structured output${sr?.error ? `: ${sr.error}` : ""} (events: ${JSON.stringify(events).slice(0, 300)})`, this.now());
              metrics.inc("manus_task_failed");
            }
          } else if (status === "error") {
            this.svc.missions.markFailed(m.id, extractErrorMessage(events) ?? "Manus reported agent_status=error", this.now());
            metrics.inc("manus_task_failed");
          } else if (status === "waiting") {
            // Manus pauses on tool limitations (login walls, dynamic pages) and
            // WAITS for a human — the answer "just sits there" forever. Auto-nudge
            // it to continue, capped so a truly stuck task still times out.
            const n = this.nudges.get(m.id) ?? 0;
            if (n < 3) {
              this.nudges.set(m.id, n + 1);
              await client.sendMessage(m.externalId, "continue — work with what you can access, finish the analysis, and deliver the structured output").catch((e) => log.warn(`manus: nudge of #${m.id} failed: ${(e as Error).message}`));
              metrics.inc("manus_task_nudged");
              log.info(`manus: mission #${m.id} was WAITING — auto-nudged to continue (${n + 1}/3)`);
            }
            if ((m.sentAt ?? m.createdAt) + timeoutMs < this.now()) {
              this.svc.missions.markFailed(m.id, `timed out while waiting for input despite ${n} auto-nudges`, this.now());
              metrics.inc("manus_task_timeout");
            }
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

  /** Discovery resolution: inject every valid candidate into the LOCAL pipeline.
   *  Manus proposes; the engine verifies (Stage-0 RugCheck/holders) and monitors.
   *  The candidate's research arrives pre-attached (injectResult, source=manus),
   *  so the readiness gate sees it as researched — local fundamentals still decide. */
  private applyDiscovery(m: MissionRow, value: Record<string, unknown>): void {
    const now = this.now();
    this.svc.missions.setResultRaw(m.id, value, "manus", now);
    const candidates = Array.isArray(value.candidates) ? (value.candidates as Array<Record<string, unknown>>) : [];
    let injected = 0, invalid = 0;
    for (const c of candidates.slice(0, 12)) {
      const mint = typeof c.contractAddress === "string" ? c.contractAddress.trim() : "";
      const ticker = typeof c.ticker === "string" ? c.ticker.replace(/^\$/, "") : undefined;
      if (!isValidSolanaAddress(mint)) {
        invalid++;
        log.warn(`manus discovery #${m.id}: invalid contract address "${String(c.contractAddress).slice(0, 50)}" ($${ticker ?? "?"}) — skipped`);
        continue;
      }
      // Attach the research FIRST so the attention facet + readiness gate see it
      // the moment the coin is scored.
      const result: MissionResult = {
        recommendation: "confirm",
        confidence: num(c.confidence, 60),
        scores: flatScores(c),
        narrative: typeof c.narrative === "string" ? c.narrative : undefined,
        reasons: [
          ...(typeof c.whyItMoons === "string" && c.whyItMoons ? [c.whyItMoons] : []),
          ...(typeof c.humanityEvidence === "string" && c.humanityEvidence ? [c.humanityEvidence] : []),
          ...(typeof c.rugcheckSummary === "string" && c.rugcheckSummary ? [`rugcheck: ${c.rugcheckSummary}`] : []),
          ...(typeof c.bearCase === "string" && c.bearCase ? [`bear: ${c.bearCase}`] : []),
        ].slice(0, 8),
        provider: "manus",
      };
      this.svc.attention?.injectResult(resultToRecord(mint, ticker, result, now));
      // Then hand the coin to the live pipeline (Stage-0 verifies Manus's claims).
      this.svc.runtime.injectToken?.({
        mint,
        symbol: ticker,
        name: typeof c.name === "string" ? c.name : undefined,
        seenAt: now,
        discoverySource: "manus",
      });
      injected++;
      metrics.inc("manus_discovery_candidate");
    }
    metrics.inc("manus_discovery_resolved");
    log.ok(`manus: discovery #${m.id} resolved — ${injected} candidate(s) injected into the pipeline${invalid ? `, ${invalid} invalid address(es) skipped` : ""} (reviewed/rejected: ${num(value.rejectedCount, 0)})`);
  }

  /** Fallback for UNSTRUCTURED answers (operator-run chats have no schema): pull
   *  Solana mint addresses straight out of Manus's chat text and ingest them as
   *  candidates. Conservative on the fabrication front — confidence 50, the text
   *  head as narrative, and reasons say the answer was unstructured; the local
   *  pipeline still verifies everything on-chain before anything trades. */
  private applyChatText(m: MissionRow, events: unknown[]): boolean {
    const texts = extractAssistantTexts(events);
    if (!texts.length) return false;
    const all = texts.join("\n");
    const mints = [...new Set((all.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []).filter((x) => isValidSolanaAddress(x)))].slice(0, 12);
    if (!mints.length) return false;
    const now = this.now();
    const head = all.replace(/\s+/g, " ").slice(0, 400);
    this.svc.missions.setResultRaw(m.id, { unstructured: true, mints, textHead: head }, "manus", now);
    for (const mint of mints) {
      const result: MissionResult = {
        recommendation: "confirm",
        confidence: 50,
        narrative: `from Manus chat: ${head.slice(0, 160)}`,
        reasons: ["unstructured Manus chat answer — address extracted from text; local on-chain verification only"],
        provider: "manus",
      };
      this.svc.attention?.injectResult(resultToRecord(mint, undefined, result, now));
      this.svc.runtime.injectToken?.({ mint, seenAt: now, discoverySource: "manus" });
      metrics.inc("manus_chat_candidate");
    }
    metrics.inc("manus_chat_resolved");
    log.ok(`manus: mission #${m.id} resolved from CHAT TEXT — ${mints.length} address(es) extracted + injected`);
    return true;
  }

  /** Deep-dive resolution: apply each per-coin verdict through the advisory path
   *  (tracked coins re-score immediately; others cache for future evaluation). */
  private applyDeepdive(m: MissionRow, value: Record<string, unknown>): void {
    const now = this.now();
    this.svc.missions.setResultRaw(m.id, value, "manus", now);
    const results = Array.isArray(value.results) ? (value.results as Array<Record<string, unknown>>) : [];
    let applied = 0;
    for (const r of results) {
      const mint = typeof r.contractAddress === "string" ? r.contractAddress.trim() : "";
      if (!isValidSolanaAddress(mint)) continue;
      const rec = String(r.recommendation ?? "");
      const result: MissionResult = {
        recommendation: (["confirm", "caution", "unsure", "avoid"].includes(rec) ? rec : "unsure") as MissionResult["recommendation"],
        confidence: num(r.confidence, 50),
        scores: flatScores(r),
        narrative: typeof r.narrative === "string" ? r.narrative : undefined,
        reasons: [
          ...(typeof r.keyFinding === "string" && r.keyFinding ? [r.keyFinding] : []),
          ...(typeof r.bearCase === "string" && r.bearCase ? [`bear: ${r.bearCase}`] : []),
        ].slice(0, 6),
        provider: "manus",
      };
      this.svc.attention?.injectResult(resultToRecord(mint, undefined, result, now));
      applied++;
    }
    metrics.inc("manus_deepdive_resolved");
    log.ok(`manus: deep-dive #${m.id} resolved — ${applied}/${results.length} verdicts applied`);
  }
}

/** Minimal Mission wrapper for non-per-coin missions (discovery/deepdive). */
function pseudoMission(mint: string, symbol: string, objective: string, now: number): Mission {
  return { mint, symbol, objective, verdict: "-", conviction: 0, buckets: [], gaps: [], outputContract: "structured (see schema)", createdAt: now };
}

function num(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

/** Map the FLAT per-coin score fields (Manus schema constraint: no nested object
 *  inside array items) onto the MissionResult scores shape. */
function flatScores(o: Record<string, unknown>): MissionResult["scores"] | undefined {
  if (typeof o.attentionScore !== "number") return undefined;
  return {
    humanity: typeof o.humanityScore === "number" ? o.humanityScore : undefined,
    virality: typeof o.viralityScore === "number" ? o.viralityScore : undefined,
    outsideCrypto: typeof o.outsideCryptoScore === "number" ? o.outsideCryptoScore : undefined,
    culturalStrength: typeof o.culturalStrengthScore === "number" ? o.culturalStrengthScore : undefined,
    attention: o.attentionScore,
  };
}
