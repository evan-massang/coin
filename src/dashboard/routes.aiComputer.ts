import { Router } from "express";
import type { Services } from "../services.js";
import { isValidSolanaAddress } from "../sources/solanaRpc.js";

// AI Computer tab API (Phase 7). Read-only research + audit + (un)approval. The
// approve endpoint exists for completeness but refuses anything consequential.
export function aiComputerRoutes(svc: Services): Router {
  const r = Router();

  r.post("/ai-computer/task", (req, res) => {
    const mint = typeof req.body?.mint === "string" ? req.body.mint.trim() : "";
    if (!isValidSolanaAddress(mint)) {
      res.status(400).json({ ok: false, error: "invalid mint" });
      return;
    }
    const taskId = svc.aiComputer.research(mint);
    res.json({ ok: true, taskId, queued: svc.aiComputer.queueSize });
  });

  r.get("/ai-computer/result/:taskId", (req, res) => {
    const result = svc.aiComputer.getResult(req.params.taskId);
    if (!result) {
      res.json({ ok: true, pending: true });
      return;
    }
    res.json({ ok: true, result });
  });

  r.get("/ai-computer/audit", (_req, res) => {
    res.json(svc.aiComputer.audit.list(200));
  });

  r.post("/ai-computer/approve/:id", (req, res) => {
    // Refuses wallet/financial/mutating actions by design.
    res.json(svc.aiComputer.approvals.approve(req.params.id));
  });

  return r;
}
