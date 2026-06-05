import open from "open";
import { createServices } from "./services.js";
import { startServer } from "./dashboard/server.js";
import { PumpPortalClient } from "./sources/pumpPortal.js";
import { EntryPipeline } from "./engine/entry.js";
import { WalletObserver } from "./wallet/walletObserver.js";
import { ExitEngine } from "./engine/exitEngine.js";
import { detectAlphaExit } from "./engine/copyTracker.js";
import { PaperTrader } from "./paper/paperExecution.js";
import { OutcomeTracker } from "./learning/featureStore.js";
import { AdaptiveThresholdEngine } from "./learning/adaptiveThresholds.js";
import { log } from "./util/logger.js";

// Entry point. Phase 1 brings up the dashboard + store + alert plumbing. Later
// phases attach engines (scanner, wallet observer, exit engine, paper trading,
// learning) onto the same Services container.
async function main(): Promise<void> {
  const svc = createServices();

  // Initialize the paper sim wallet if paper trading is enabled.
  if (svc.settings.get("paperEnabled")) {
    svc.paper.ensure(svc.settings.get("paperStartingBalanceSol"));
  }

  const { url, close } = await startServer(svc);
  log.ok(`Meme Signal Engine ready → ${url}  (READ-ONLY: never holds a key, never signs)`);

  // Live Signal mode: new-token scanner + Stage-0 gate. Guarded so the dashboard
  // can run standalone (NO_ENGINE=1). Phase 3 attaches the observe→score hook.
  let entry: EntryPipeline | undefined;
  let observer: WalletObserver | undefined;
  let walletExits: ExitEngine | undefined;
  let paperExits: ExitEngine | undefined;
  let outcomes: OutcomeTracker | undefined;
  let learning: AdaptiveThresholdEngine | undefined;
  if (process.env.NO_ENGINE !== "1") {
    // Paper trader (Mode 3). Reacts to BUY signals; its sells run through the
    // same exit engine. Pure simulation — never keys, never signing, never chain.
    const paper = new PaperTrader(svc);
    if (svc.settings.get("paperEnabled")) paper.ensureWallet();

    const pump = new PumpPortalClient({ newTokens: true });
    entry = new EntryPipeline(svc, pump, {
      hooks: { onDecision: (decision) => void paper.onDecision(decision) },
    });
    entry.start();

    paperExits = new ExitEngine(svc, {
      source: "paper",
      onExit: (pos, sig) => void paper.executeSell(pos, sig),
    });
    paperExits.start();

    // Learning loop (Phase 8): fill the journal price path + learning features,
    // then emit threshold suggestions (Manual Review default; bounded Auto-Tune).
    outcomes = new OutcomeTracker(svc);
    outcomes.start();
    learning = new AdaptiveThresholdEngine(svc);
    learning.start();

    // Read-only wallet observer (Mode 2). Self-checks the enabled flag each
    // poll, so toggling it in the UI takes effect without a restart.
    observer = new WalletObserver(svc);
    observer.start();

    // Exit engine over observed positions — coaches the manual sell with
    // SELL_TRIM / SELL_EXIT_NOW (it only alerts; the user sells in Phantom).
    // A tracked alpha wallet exiting the same mint is a hard exit signal (§1.9).
    walletExits = new ExitEngine(svc, {
      source: "wallet",
      hardSignalsFor: (pos) => {
        const copy = svc.wallets.byKind("copy").map((w) => w.address);
        if (copy.length === 0) return undefined;
        const recent = svc.trades.forMint(pos.mint, Date.now() - 60 * 60 * 1000);
        const alphaWalletExited = copy.some((w) => detectAlphaExit(w, recent, pos.mint));
        return alphaWalletExited ? { alphaWalletExited } : undefined;
      },
    });
    walletExits.start();

    // Always-on Council Room: the AI panel continuously debates the live coins
    // (rotating, one at a time) — no manual trigger. Advisory only; never
    // overrides safety, risk, or the verdict. No-op until seats are enabled.
    svc.aiComputer.startAutoDebate();
  } else {
    log.warn("NO_ENGINE=1 — scanner disabled, dashboard only");
  }

  if (process.env.NO_OPEN !== "1") {
    try {
      await open(url);
    } catch {
      /* headless / no browser — fine */
    }
  }

  const shutdown = async (sig: string) => {
    log.info(`received ${sig}, shutting down`);
    try {
      entry?.stop();
      observer?.stop();
      walletExits?.stop();
      paperExits?.stop();
      outcomes?.stop();
      learning?.stop();
      svc.aiComputer.stopAutoDebate();
      svc.aiComputer.shutdownOpencode();
      await close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.err(`fatal: ${(err as Error).stack ?? String(err)}`);
  process.exit(1);
});
