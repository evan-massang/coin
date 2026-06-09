import { Router } from "express";
import type { Services } from "../services.js";
import type { Decision, SafetyResult } from "../types.js";
import type { AttentionScores, AttentionEvidence } from "../attention/types.js";
import type { AttentionRecord } from "../attention/attentionService.js";
import type { MissionResult } from "../store/repositories/missionRepo.js";
import { clamp01 } from "../attention/types.js";
import { generateMission } from "../research/missionGenerator.js";
import { isValidSolanaAddress } from "../sources/solanaRpc.js";

// Project Hermes — the Manus mission board (the first concrete, key-free Manus
// implementation: operator-in-the-loop). The engine composes a structured
// investigation Mission from what it already knows; the operator runs Manus and
// pastes the recommendation back; the recommendation flows through the SAME
// attention re-score path (decide() runs the hard safety gate FIRST), so it is
// advisory and can never override safety, force a buy, or lower the gate.
export function manusRoutes(svc: Services): Router {
  const r = Router();

  // Compose + store a mission for a coin the engine has already scored.
  r.post("/manus/mission", (req, res) => {
    const mint = typeof req.body?.mint === "string" ? req.body.mint.trim() : "";
    if (!isValidSolanaAddress(mint)) {
      res.status(400).json({ ok: false, error: "invalid mint" });
      return;
    }
    const history = svc.signals.forMint(mint, 100);
    const sig = history.at(-1);
    if (!sig) {
      res.status(404).json({ ok: false, error: "no signal for this mint yet — the engine must observe + score it first" });
      return;
    }
    const decision: Decision = {
      mint: sig.mint,
      symbol: sig.symbol,
      verdict: sig.verdict,
      conviction: sig.conviction,
      scores: sig.scores,
      reasons: sig.reasons,
      flags: sig.flags,
      caps: sig.caps,
      redFlags: sig.redFlags,
      pairCreatedAt: sig.pairCreatedAt,
      at: sig.at,
    };
    // Safety checks aren't journalled; synthesize the gate result we DO know
    // (pass iff it wasn't an AVOID). Empty checks ⇒ the rugcheck/holders buckets
    // read as thin, which is honest: it tells Manus to verify them itself.
    const safety: SafetyResult = {
      pass: sig.verdict !== "AVOID",
      stage: 1,
      checks: [],
      unknownCount: 0,
      fatalReasons: [],
      score: sig.scores.safety ?? 0,
    };
    const mission = generateMission({
      decision,
      safety,
      attention: svc.attention?.record(mint),
      intel: svc.runtime.intel.get(mint),
      now: Date.now(),
    });
    const id = svc.missions.insert(mission);
    res.json({ ok: true, id, mission });
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

  // Paste back a recommendation (operator relaying Manus, or any provider). It is
  // stored AND injected into the attention path so the coin re-scores on merit.
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
    svc.missions.setResult(id, result, now);
    // Route through the SAME advisory path as any research provider. injectResult
    // fires onComplete → rescoreWithAttention → decide() (safety gate first), so
    // this cannot override safety or force a buy.
    const rec = resultToRecord(row.mint, row.symbol, result, now);
    svc.attention?.injectResult(rec);
    res.json({ ok: true, resolved: true, rescored: Boolean(svc.attention), attention: rec.scores.attention });
  });

  return r;
}

/** Map a recommendation (+ optional explicit sub-scores) to an AttentionScores. */
function resultToScores(result: MissionResult): AttentionScores {
  const recBase: Record<string, number> = { confirm: 78, caution: 45, unsure: 35, avoid: 12 };
  const base = recBase[result.recommendation] ?? 35;
  const sc = result.scores ?? {};
  const attention = num(sc.attention, base);
  return {
    humanity: num(sc.humanity, attention),
    virality: num(sc.virality, attention),
    outsideCrypto: num(sc.outsideCrypto, attention),
    culturalStrength: num(sc.culturalStrength, attention),
    attention,
    confidence: clamp01((result.confidence ?? 60) / 100),
    tags: [],
    narrative: result.narrative ?? `Manus: ${result.recommendation} (confidence ${Math.round(result.confidence)})`,
    reasons: result.reasons ?? [`mission board recommendation: ${result.recommendation}`],
  };
}

function resultToRecord(mint: string, symbol: string | undefined, result: MissionResult, at: number): AttentionRecord {
  const evidence: AttentionEvidence = { mint, symbol, query: symbol ?? mint, posts: [], platforms: [], links: [], fetchedAt: at };
  return { mint, scores: resultToScores(result), evidence, at, source: result.provider ?? "manus" };
}

function num(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}
