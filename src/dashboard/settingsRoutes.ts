import { Router } from "express";
import type { Services } from "../services.js";
import { SettingsSchema, SECRET_KEYS, type Settings } from "../store/settingsStore.js";
import { isValidSolanaAddress, makeConnection, getSolBalance } from "../sources/solanaRpc.js";
import { log } from "../util/logger.js";

export function settingsRoutes(svc: Services): Router {
  const r = Router();

  // Redacted: secret keys come back as booleans (present/absent), never values.
  r.get("/settings", (_req, res) => {
    res.json(svc.settings.redacted());
  });

  // Validate + persist a partial update. Empty secret fields are ignored so a
  // blank box in the UI never wipes an existing key.
  r.put("/settings", (req, res) => {
    const partialSchema = SettingsSchema.partial();
    const parsed = partialSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const patch: Partial<Settings> = { ...parsed.data };
    for (const k of SECRET_KEYS) {
      if (patch[k] !== undefined && patch[k] === "") delete patch[k];
    }
    // update() rejects values the partial schema can't (non-finite numbers like
    // JSON 1e999 → Infinity) — surface that as a clean 400, not a 500.
    let changes;
    try {
      changes = svc.settings.update(patch, "user");
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
      return;
    }

    // BUGFIX: enabling paper / changing the starting balance must initialize the
    // sim wallet immediately, else /api/paper reports 0 SOL until a restart or
    // first buy. Only (re)initialize when the wallet is FRESH (no trades) so we
    // never wipe an in-progress sim.
    if (patch.paperEnabled !== undefined || patch.paperStartingBalanceSol !== undefined) {
      const s = svc.settings.all();
      if (s.paperEnabled) {
        const fresh = !svc.paper.get() || svc.paper.fills(1).length === 0;
        if (fresh) svc.paper.reset(s.paperStartingBalanceSol);
      }
    }

    svc.hub.broadcast("settings", svc.settings.redacted());
    svc.hub.broadcast("paper", { reset: true });
    res.json({ ok: true, changed: changes.map((c) => c.setting), settings: svc.settings.redacted() });
  });

  // Hard reset to defaults.
  r.post("/settings/reset", (_req, res) => {
    svc.settings.reset();
    svc.hub.broadcast("settings", svc.settings.redacted());
    res.json({ ok: true, settings: svc.settings.redacted() });
  });

  // Test the read-only wallet connection: validate the address + fetch balance.
  r.post("/settings/test-connection", async (req, res) => {
    const address = typeof req.body?.address === "string" ? req.body.address.trim() : svc.settings.get("walletAddress");
    if (!address) {
      res.json({ ok: false, error: "No wallet address set." });
      return;
    }
    if (!isValidSolanaAddress(address)) {
      res.json({ ok: false, error: "Not a valid Solana address." });
      return;
    }
    try {
      const conn = makeConnection(svc.settings.all());
      const balanceSol = await withTimeout(getSolBalance(conn, address), 8000);
      res.json({ ok: true, address, balanceSol });
    } catch (err) {
      log.warn(`test-connection failed: ${(err as Error).message}`);
      res.json({ ok: false, address, error: (err as Error).message });
    }
  });

  return r;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), ms)),
  ]);
}
