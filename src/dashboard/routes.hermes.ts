import { Router } from "express";
import type { Services } from "../services.js";
import { buildCaseFile } from "../research/caseFile.js";
import { thesisDecayFlags } from "../engine/exitEngine.js";

// Project Hermes Phase 9/17 — read-only case-file API. Joins existing per-mint
// tables into one record so a recommendation can be replayed end-to-end. No
// trading effect, no writes.
export function hermesRoutes(svc: Services): Router {
  const r = Router();

  r.get("/hermes/case/:mint", (req, res) => {
    const mint = String(req.params.mint);
    const signals = svc.signals.forMint(mint, 100);
    if (!signals.length) {
      res.status(404).json({ ok: false, error: "no signals for this mint" });
      return;
    }
    const caseFile = buildCaseFile({
      mint,
      signals,
      council: svc.council.forMint(mint, 60),
      fills: svc.paper.fillsForMint(mint, 100),
      missions: svc.missions.forMint(mint, 50),
      attention: svc.attention?.record(mint),
      intel: svc.runtime.intel.get(mint),
      now: Date.now(),
    });
    res.json(caseFile);
  });

  // "Why are we still holding this?" — the honest, per-position answer (operator
  // ask: a red position must explain itself). Lists every exit condition and its
  // current distance, the entry thesis, thesis health, and the latest research read.
  r.get("/hermes/why/:mint", (req, res) => {
    const mint = String(req.params.mint);
    const pos = svc.paperPositions.openByMint(mint);
    if (!pos) {
      res.status(404).json({ ok: false, error: "no open paper position for this mint" });
      return;
    }
    const s = svc.settings.all();
    const now = Date.now();
    const pnlPct = pos.entryPriceUsd > 0 && pos.lastPriceUsd ? (pos.lastPriceUsd / pos.entryPriceUsd - 1) * 100 : null;
    const peakPct = pos.entryPriceUsd > 0 && pos.peakPriceUsd ? (pos.peakPriceUsd / pos.entryPriceUsd - 1) * 100 : null;
    const heldMin = Math.round((now - pos.entryAtMs) / 60_000);
    const maxHoldMin = Math.round((pos.exitPlan?.maxHoldMs || s.maxHoldMinutes * 60_000) / 60_000);
    const stopAtPct = -s.stopLossPct * 100;
    const mult = pos.entryPriceUsd > 0 && pos.lastPriceUsd ? pos.lastPriceUsd / pos.entryPriceUsd : 1;
    const nextRung = pos.exitPlan?.ladder?.find((x) => !x.done);

    const holding: string[] = [];
    let pending = false;
    if (pnlPct == null) {
      holding.push("price unknown right now (DexScreener gap) — the exit engine re-prices every ~15s and can't act blind");
    } else if (pnlPct <= stopAtPct) {
      holding.push(`STOP BREACHED: ${pnlPct.toFixed(0)}% ≤ stop ${stopAtPct.toFixed(0)}% — the exit fires on the next engine tick (~15s)`);
      pending = true;
    } else {
      holding.push(`stop loss at ${stopAtPct.toFixed(0)}% from entry — currently ${pnlPct.toFixed(0)}%, so not breached (${(pnlPct - stopAtPct).toFixed(0)}pp of room)`);
    }
    if (heldMin >= maxHoldMin) {
      holding.push(`TIME STOP REACHED: held ${heldMin}m ≥ ${maxHoldMin}m — exits on the next tick`);
      pending = true;
    } else {
      holding.push(`time stop at ${maxHoldMin}m — held ${heldMin}m (${maxHoldMin - heldMin}m left before forced exit)`);
    }
    if (nextRung) holding.push(`next take-profit rung at ${nextRung.multiple}x (sell ${Math.round(nextRung.sellPct * 100)}%) — currently ${mult.toFixed(2)}x`);
    if (peakPct != null && peakPct > 0) {
      holding.push(`trailing stop armed: peak was +${peakPct.toFixed(0)}%; locks in if price drops ${Math.round((pos.exitPlan?.trailingStopPct ?? 0.3) * 100)}% from peak`);
    } else {
      holding.push("trailing stop arms only once the position is in profit — never been green, so the hard stop/time stop govern");
    }

    // Entry thesis + current research read.
    const entrySig = svc.signals.forMint(mint, 100).find((x) => x.verdict === "BUY_SMALL" || x.verdict === "BUY_STRONG");
    const att = svc.attention?.record(mint);
    const health = thesisDecayFlags(att?.scores.attention, entrySig?.scores.attention);
    // Latest batched deep-dive verdict for this mint, if any.
    let deepdive: { recommendation?: string; narrative?: string } | undefined;
    for (const m of svc.missions.recent(20)) {
      if (m.kind !== "deepdive" || m.status !== "resolved") continue;
      const results = ((m.resultRaw as { results?: Array<Record<string, unknown>> })?.results ?? []) as Array<Record<string, unknown>>;
      const hit = results.find((x) => x.contractAddress === mint);
      if (hit) {
        deepdive = { recommendation: String(hit.recommendation ?? ""), narrative: typeof hit.narrative === "string" ? hit.narrative : undefined };
        break;
      }
    }

    res.json({
      ok: true,
      mint,
      symbol: pos.symbol,
      pnlPct,
      heldMin,
      bottomLine: pending
        ? "an exit condition is met — the engine sells on its next tick"
        : "no exit condition met — holding per the plan above (the engine never exits on red alone; it exits on stop, time, trailing or thesis triggers)",
      holding,
      thesis: entrySig
        ? { verdict: entrySig.verdict, conviction: entrySig.conviction, attentionAtEntry: Math.round(entrySig.scores.attention ?? 0), reasons: entrySig.reasons.slice(0, 3) }
        : null,
      thesisHealth: health[0] ?? (att && entrySig?.scores.attention ? "intact" : "unknown"),
      research: att ? { source: att.source, attention: Math.round(att.scores.attention), narrative: att.scores.narrative } : null,
      deepdive: deepdive ?? null,
    });
  });

  return r;
}
