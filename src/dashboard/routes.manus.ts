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
  r.get("/manus/mission/:id/prompt", (req, res) => {
    const row = svc.missions.get(parseInt(req.params.id, 10));
    if (!row) {
      res.status(404).json({ ok: false, error: "mission not found" });
      return;
    }
    res.type("text/plain").send(missionToPrompt(row.mission));
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
