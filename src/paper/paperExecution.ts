import type { Services } from "../services.js";
import type { Decision, ExitSignal, Position } from "../types.js";
import { PaperWallet } from "./paperWallet.js";
import type { PositionManager } from "../engine/positionManager.js";
import { createPaperPositionManager } from "./paperPositionManager.js";
import { sizePaperBuy } from "./paperRiskManager.js";
import { sizeFromRiskPct } from "../risk/riskSizing.js";
import { defaultExitPlan } from "../engine/exitEngine.js";
import { fetchDexSnapshot } from "../sources/dexscreener.js";
import { getSolUsd } from "../sources/coingecko.js";
import { RateLimiter } from "../util/rateLimiter.js";
import { log } from "../util/logger.js";

// Pure simulated-fill math. Buys fill at price worsened by slippage+fee; sells
// at price reduced by the same. Everything in SOL via the SOL/USD rate.

export interface SimBuy {
  tokenAmount: number;
  effPriceUsd: number;
  solSpent: number;
}

export function simulateBuy(priceUsd: number, solUsd: number, sizeSol: number, slippagePct: number): SimBuy {
  const effPriceUsd = priceUsd * (1 + slippagePct / 100);
  const usdSpent = sizeSol * solUsd;
  const tokenAmount = effPriceUsd > 0 ? usdSpent / effPriceUsd : 0;
  return { tokenAmount, effPriceUsd, solSpent: sizeSol };
}

export interface SimSell {
  solReceived: number;
  effPriceUsd: number;
}

export function simulateSell(priceUsd: number, solUsd: number, tokenAmount: number, slippagePct: number): SimSell {
  const effPriceUsd = priceUsd * (1 - slippagePct / 100);
  const usd = tokenAmount * effPriceUsd;
  const solReceived = solUsd > 0 ? usd / solUsd : 0;
  return { solReceived, effPriceUsd };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Mode 3 paper trader. Reacts to BUY signals with sized fake buys (risk rules in
 * paperRiskManager) and reuses the SAME exit engine for sells (wired by the
 * caller as the paper ExitEngine's onExit). Pure simulation — never a key, never
 * a signature, never on-chain.
 */
export class PaperTrader {
  private readonly wallet: PaperWallet;
  private readonly positions: PositionManager;
  private readonly priceLimiter = new RateLimiter(4);

  constructor(private readonly svc: Services) {
    this.wallet = new PaperWallet(svc.paper);
    this.positions = createPaperPositionManager(svc);
  }

  ensureWallet(): void {
    this.wallet.ensure(this.svc.settings.get("paperStartingBalanceSol"));
  }

  async onDecision(decision: Decision): Promise<void> {
    const s = this.svc.settings.all();
    if (!s.paperEnabled) return;
    if (decision.verdict !== "BUY_SMALL" && decision.verdict !== "BUY_STRONG") return;

    this.ensureWallet();
    const balanceSol = this.wallet.balance();

    const snap = await this.price(decision.mint);
    if (!snap?.priceUsd) return; // can't price → skip

    // Prefer MicroFish's dynamic size when available; else the fixed rules.
    let sizeSol: number;
    if (s.riskMode === "microfish" && decision.suggestedRiskPct !== undefined) {
      sizeSol = sizeFromRiskPct(decision.suggestedRiskPct, balanceSol, decision.maxPositionSol ?? s.paperMaxPositionSol);
      if (sizeSol <= 0) return; // MicroFish sized it to zero (risk gate)
    } else {
      const sizing = sizePaperBuy({
        verdict: decision.verdict,
        balanceSol,
        maxPositionSol: s.paperMaxPositionSol,
        riskPerTradePct: s.paperRiskPerTradePct,
        safetyPass: true, // a BUY verdict already cleared the safety gate
        organicScore: decision.scores.organic,
        minOrganicScore: s.minOrganicScore,
        lateEntryRisk: decision.scores.lateEntryRisk,
        maxLateEntryRisk: s.maxLateEntryRisk,
        liquidityUsd: snap.liquidityUsd,
        minLiquidityUsd: s.minLiquidityUsd,
      });
      if (!sizing.buy) return;
      sizeSol = sizing.sizeSol;
    }

    const solUsd = await getSolUsd();
    const fill = simulateBuy(snap.priceUsd, solUsd, sizeSol, s.paperSlippagePct);
    if (fill.tokenAmount <= 0) return;
    if (!this.wallet.debit(sizeSol)) return;

    const now = Date.now();
    const priceSol = fill.effPriceUsd / solUsd;
    const res = this.positions.applyActivity(
      { mint: decision.mint, side: "buy", tokenAmount: fill.tokenAmount, solAmount: sizeSol, priceSol, at: now, signature: "paper" },
      { symbol: decision.symbol, solUsd },
    );
    // Install the real exit ladder on a freshly opened paper position.
    if (res.marked === "entered" && res.position) {
      res.position.exitPlan = defaultExitPlan(s.maxHoldMinutes * 60_000);
      this.svc.paperPositions.update(res.position);
    }
    this.svc.paper.recordFill({
      mint: decision.mint,
      side: "buy",
      priceUsd: fill.effPriceUsd,
      solAmount: sizeSol,
      tokenAmount: fill.tokenAmount,
      realizedPnlSol: 0,
      remainingTokenAmount: res.position?.tokenAmount ?? fill.tokenAmount,
      reason: decision.verdict,
      at: now,
    });
    log.info(`paper: bought ${decision.symbol ?? decision.mint.slice(0, 8)} for ${sizeSol.toFixed(3)} SOL`);
    this.svc.hub.broadcast("paper", { action: "buy", mint: decision.mint });
  }

  /** Wired as the paper ExitEngine's onExit — executes the simulated sale. */
  async executeSell(pos: Position, signal: ExitSignal): Promise<void> {
    const s = this.svc.settings.all();
    const solUsd = await getSolUsd();
    let priceUsd = pos.lastPriceUsd;
    if (!priceUsd) {
      const snap = await this.price(pos.mint);
      priceUsd = snap?.priceUsd;
    }
    if (!priceUsd) return;

    const sellTokens = Math.min(pos.tokenAmount, pos.tokenAmount * signal.sellPct);
    if (sellTokens <= 0) return;
    const sim = simulateSell(priceUsd, solUsd, sellTokens, s.paperSlippagePct);
    const costFraction = pos.tokenAmount > 0 ? pos.solInvested * (sellTokens / pos.tokenAmount) : 0;
    const realizedSol = sim.solReceived - costFraction;

    this.wallet.credit(sim.solReceived);
    const now = Date.now();
    const priceSol = sim.effPriceUsd / solUsd;
    const res = this.positions.applyActivity(
      { mint: pos.mint, side: "sell", tokenAmount: sellTokens, solAmount: sim.solReceived, priceSol, at: now, signature: "paper" },
      { symbol: pos.symbol, solUsd },
    );
    this.svc.paper.recordFill({
      mint: pos.mint,
      side: "sell",
      priceUsd: sim.effPriceUsd,
      solAmount: sim.solReceived,
      tokenAmount: sellTokens,
      realizedPnlSol: realizedSol,
      remainingTokenAmount: res.position?.tokenAmount ?? 0,
      reason: signal.reason,
      at: now,
    });
    log.info(`paper: ${signal.kind} ${pos.symbol ?? pos.mint.slice(0, 8)} (${realizedSol >= 0 ? "+" : ""}${realizedSol.toFixed(3)} SOL)`);
    this.svc.hub.broadcast("paper", { action: "sell", mint: pos.mint });
  }

  private async price(mint: string): Promise<{ priceUsd?: number; liquidityUsd?: number } | undefined> {
    if (!this.priceLimiter.tryAcquire()) return undefined;
    return fetchDexSnapshot(mint).catch(() => undefined);
  }
}
