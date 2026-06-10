import { Router } from "express";
import type { Services } from "../services.js";
import type { MissionResult } from "../store/repositories/missionRepo.js";
import { composeMissionForMint } from "../research/composeMission.js";
import { resultToRecord } from "../research/missionResult.js";
import { missionToPrompt } from "../research/missionPrompt.js";
import { isValidSolanaAddress } from "../sources/solanaRpc.js";

// Project Hermes — the Manus mission board. With a Manus API key configured the
// mission is dispatched to the Manus API automatically (the operator watches the
// task live via its task_url); without one it stays the operator-in-the-loop
// copy-paste board. Either way the recommendation flows through the SAME
// attention re-score path (decide() runs the hard safety gate FIRST): advisory,
// can never override safety, force a buy, or lower the gate.
export function manusRoutes(svc: Services): Router {
  const r = Router();

  // Compose + store a mission; auto-dispatch to the Manus API when available.
  r.post("/manus/mission", async (req, res) => {
    const mint = typeof req.body?.mint === "string" ? req.body.mint.trim() : "";
    if (!isValidSolanaAddress(mint)) {
      res.status(400).json({ ok: false, error: "invalid mint" });
      return;
    }
    const mission = composeMissionForMint(svc, mint, Date.now());
    if (!mission) {
      res.status(404).json({ ok: false, error: "no signal for this mint yet — the engine must observe + score it first" });
      return;
    }
    const id = svc.missions.insert(mission);
    let sent = false;
    let taskUrl: string | undefined;
    let sendError: string | undefined;
    if (svc.manus?.available()) {
      const sendRes = await svc.manus.sendMission(id, "operator");
      sent = sendRes.ok;
      taskUrl = sendRes.taskUrl;
      sendError = sendRes.error;
    }
    res.json({ ok: true, id, mission, sent, taskUrl, sendError, manusConfigured: Boolean(svc.manus?.available()) });
  });

  // The exact prompt a researcher gets for a mission (Phase 8 — nothing hidden).
  // Discovery/deepdive prompts embed dispatch-time live seeds, so the verbatim
  // dispatched text is stored on the mission; research prompts re-render deterministically.
  r.get("/manus/mission/:id/prompt", (req, res) => {
    const row = svc.missions.get(parseInt(req.params.id, 10));
    if (!row) {
      res.status(404).json({ ok: false, error: "mission not found" });
      return;
    }
    res.type("text/plain").send(row.mission.renderedPrompt ?? missionToPrompt(row.mission));
  });

  // Hermes Phase 3 — fire a DISCOVERY mission: Manus hunts candidates with the
  // operator playbook; resolution injects every valid mint into the live pipeline.
  r.post("/manus/discover", async (_req, res) => {
    if (!svc.manus?.available()) {
      res.status(409).json({ ok: false, error: "no Manus API key configured (CONFIG → Manus API key)" });
      return;
    }
    const out = await svc.manus.dispatchDiscovery("operator");
    res.status(out.ok ? 200 : 409).json(out);
  });

  // Batched hard-opinion review. Body { mints?: string[] } — defaults to every
  // open paper position (the coins we actually hold), capped at 10.
  r.post("/manus/deepdive", async (req, res) => {
    if (!svc.manus?.available()) {
      res.status(409).json({ ok: false, error: "no Manus API key configured (CONFIG → Manus API key)" });
      return;
    }
    let coins: Array<{ mint: string; symbol?: string; note?: string }>;
    const bodyMints = Array.isArray(req.body?.mints) ? (req.body.mints as unknown[]).map(String) : undefined;
    if (bodyMints?.length) {
      const valid = bodyMints.filter((m) => isValidSolanaAddress(m)).slice(0, 10);
      if (!valid.length) {
        res.status(400).json({ ok: false, error: "no valid mints in body.mints" });
        return;
      }
      coins = valid.map((mint) => ({ mint }));
    } else {
      coins = svc.paperPositions
        .byStatus(true)
        .slice(0, 10)
        .map((p) => ({ mint: p.mint, symbol: p.symbol, note: `open paper position since ${new Date(p.entryAtMs).toISOString().slice(0, 16)}Z` }));
      if (!coins.length) {
        res.status(404).json({ ok: false, error: "no open paper positions to review — pass body.mints" });
        return;
      }
    }
    const out = await svc.manus.dispatchDeepdive(coins, "operator");
    res.status(out.ok ? 200 : 409).json({ ...out, coins: coins.length });
  });

  // ATTACH a task the operator created directly in the Manus app (paste the task
  // URL or id). A mission row is created in 'sent' state pointing at it; the
  // background poller then ingests its answer exactly like an engine-dispatched
  // mission (discovery answers inject candidates; research/deepdive re-score).
  r.post("/manus/attach", (req, res) => {
    if (!svc.manus?.available()) {
      res.status(409).json({ ok: false, error: "no Manus API key configured" });
      return;
    }
    const rawTask = String(req.body?.task ?? "").trim();
    // Accept a bare task id or any manus.im URL containing it (.../app/<id>).
    const m = rawTask.match(/(?:manus\.im\/app\/)?([A-Za-z0-9_-]{10,})\/?$/);
    const taskId = m?.[1];
    if (!taskId) {
      res.status(400).json({ ok: false, error: "pass body.task = Manus task id or manus.im/app/<id> URL" });
      return;
    }
    // discovery/deepdive only — their answers carry contract addresses; a per-coin
    // research answer has no address so an attached one couldn't be applied.
    const kind = req.body?.kind === "deepdive" ? "deepdive" : "discovery";
    const out = svc.manus.attachExternalTask(taskId, kind);
    res.status(out.ok ? 200 : 409).json(out);
  });

  // Manually dispatch an existing OPEN mission to the Manus API.
  r.post("/manus/mission/:id/send", async (req, res) => {
    if (!svc.manus?.available()) {
      res.status(409).json({ ok: false, error: "no Manus API key configured (CONFIG → Manus API key)" });
      return;
    }
    const out = await svc.manus.sendMission(parseInt(req.params.id, 10), "operator");
    res.status(out.ok ? 200 : 409).json(out);
  });

  // Live chat transcript of a mission's Manus task (Phase 7 — watch Manus work).
  r.get("/manus/mission/:id/chat", async (req, res) => {
    if (!svc.manus) {
      res.status(409).json({ ok: false, error: "manus runner not running" });
      return;
    }
    res.json(await svc.manus.getChat(parseInt(req.params.id, 10)));
  });

  // Engine ingestion feed: what came back, what was injected, when the next hunt fires.
  r.get("/manus/feed", (_req, res) => {
    const lines: Array<{ at: number; text: string; tone: "ok" | "warn" | "info" }> = [];
    for (const m of svc.missions.recent(15)) {
      const at = m.resolvedAt ?? m.sentAt ?? m.createdAt;
      if (m.status === "sent") {
        lines.push({ at, text: `⏳ #${m.id} [${m.kind}] Manus working…`, tone: "info" });
      } else if (m.status === "failed") {
        lines.push({ at, text: `✗ #${m.id} [${m.kind}] failed: ${(m.error ?? "?").slice(0, 90)}`, tone: "warn" });
      } else if (m.status === "resolved" && (m.kind === "discovery" || m.kind === "deepdive")) {
        const raw = (m.resultRaw ?? {}) as { candidates?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>>; mints?: string[]; rejectedCount?: number; unstructured?: boolean };
        const items = raw.candidates ?? raw.results ?? [];
        if (raw.unstructured && raw.mints) {
          lines.push({ at, text: `📦 #${m.id} chat answer ingested — ${raw.mints.length} address(es) extracted from Manus text`, tone: "ok" });
        } else if (items.length) {
          lines.push({ at, text: `🔭 #${m.id} [${m.kind}] resolved — ${items.length} pick(s)${raw.rejectedCount != null ? `, ${raw.rejectedCount} rejected` : ""}`, tone: "ok" });
          for (const c of items.slice(0, 6)) {
            const t = String(c.ticker ?? String(c.contractAddress ?? "").slice(0, 6));
            const rec = c.recommendation ? ` → ${c.recommendation}` : "";
            lines.push({ at, text: `   Manus recommended $${t}${rec} (conf ${Math.round(Number(c.confidence ?? 0))}) → injected into the engine`, tone: "ok" });
          }
        } else {
          lines.push({ at, text: `🔭 #${m.id} resolved — zero picks (filters rejected ${raw.rejectedCount ?? "all"})`, tone: "info" });
        }
      } else if (m.status === "resolved") {
        lines.push({ at, text: `🔬 #${m.id} $${m.symbol ?? m.mint.slice(0, 6)} → ${m.result?.recommendation ?? "?"} (conf ${Math.round(m.result?.confidence ?? 0)})`, tone: "ok" });
      }
    }
    // Next recurring hunt ETA.
    let nextHuntMin: number | null = null;
    if (svc.settings.get("manusDiscoveryEnabled") && svc.manus?.available()) {
      const last = svc.missions.latestByKind("discovery");
      const interval = svc.settings.get("manusDiscoveryIntervalMin") * 60_000;
      nextHuntMin = svc.missions.hasActiveOfKind("discovery") ? null : Math.max(0, Math.round(((last ? last.createdAt + interval : Date.now()) - Date.now()) / 60_000));
    }
    res.json({ lines: lines.sort((a, b) => b.at - a.at).slice(0, 30), nextHuntMin, discoveryEnabled: svc.settings.get("manusDiscoveryEnabled") });
  });

  // Recent missions (newest first); ?status=open for the operator's queue.
  r.get("/manus/missions", (req, res) => {
    const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const rows = req.query.status === "open" ? svc.missions.open(limit) : svc.missions.recent(limit);
    res.json(rows);
  });

  r.get("/manus/mission/:id", (req, res) => {
    const row = svc.missions.get(parseInt(req.params.id, 10));
    if (!row) {
      res.status(404).json({ ok: false, error: "mission not found" });
      return;
    }
    res.json(row);
  });

  // Paste back a recommendation (operator relaying Manus manually). Stored AND
  // injected into the attention path so the coin re-scores on merit.
  r.post("/manus/mission/:id/result", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = svc.missions.get(id);
    if (!row) {
      res.status(404).json({ ok: false, error: "mission not found" });
      return;
    }
    const body = req.body ?? {};
    const recommendation = String(body.recommendation ?? "");
    if (!["confirm", "caution", "unsure", "avoid"].includes(recommendation)) {
      res.status(400).json({ ok: false, error: "recommendation must be confirm|caution|unsure|avoid" });
      return;
    }
    const confidence = Number(body.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      res.status(400).json({ ok: false, error: "confidence must be a number 0..100" });
      return;
    }
    const result: MissionResult = {
      recommendation: recommendation as MissionResult["recommendation"],
      confidence,
      scores: typeof body.scores === "object" && body.scores ? body.scores : undefined,
      narrative: typeof body.narrative === "string" ? body.narrative : undefined,
      reasons: Array.isArray(body.reasons) ? body.reasons.map(String).slice(0, 8) : undefined,
      provider: typeof body.provider === "string" ? body.provider : "manus",
    };
    const now = Date.now();
    // Guarded: a RESOLVED mission can never be re-resolved/re-injected (red-team fix).
    if (!svc.missions.setResult(id, result, now)) {
      res.status(409).json({ ok: false, error: `mission is ${row.status} — results can only be set on open/sent missions` });
      return;
    }
    // Same advisory path as any provider; resultToRecord CLAMPS all scores to
    // 0..100 before anything touches the engine or the durable graveyard.
    const rec = resultToRecord(row.mint, row.symbol, result, now);
    svc.attention?.injectResult(rec);
    // HONEST status (V5.1 audit fix): a result on a pruned coin is cached for any
    // future evaluation but does NOT immediately re-score — say so, don't claim it did.
    const tracked = svc.runtime.isTracked?.(row.mint) ?? false;
    res.json({
      ok: true,
      resolved: true,
      attention: rec.scores.attention,
      tracked,
      note: tracked
        ? "result injected — the engine is re-scoring this coin through its safety gates"
        : "result cached (graveyard + history); coin is no longer tracked, so no immediate re-score — it applies if the coin is seen again",
    });
  });

  return r;
}
