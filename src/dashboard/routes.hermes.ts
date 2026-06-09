import { Router } from "express";
import type { Services } from "../services.js";
import { buildCaseFile } from "../research/caseFile.js";

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

  return r;
}
