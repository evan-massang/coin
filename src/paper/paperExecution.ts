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
  /** Per-position in-flight sell lock (V5.1 P0 fix — see executeSell). */
  private readonly selling = new Set<number>();

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
    // Maturing-survivor scanner ships in SHADOW: its signals are journaled (and
    // forward-tracked) for A/B vs the newborn feed, but not paper-bought —
    // UNLESS Manus deep research validated the coin (research:manus). A graduate
    // that passed the local gates AND independent Manus research is the exact
    // class Project Hermes exists to trade; unvalidated scan coins stay shadow.
    if (s.scanShadowOnly && decision.flags?.includes("src:scan") && !decision.flags?.includes("research:manus")) return;

    this.ensureWallet();
    const balanceSol = this.wallet.balance();

    const snap = await this.price(decision.mint);
    if (!snap?.priceUsd) return; // can't price → skip

    // Prefer MiroFish's dynamic size when available; else the fixed rules.
    let sizeSol: number;
    if (s.riskMode === "microfish" && decision.suggestedRiskPct !== undefined) {
      sizeSol = sizeFromRiskPct(decision.suggestedRiskPct, balanceSol, decision.maxPositionSol ?? s.paperMaxPositionSol);
      if (sizeSol <= 0) return; // MiroFish sized it to zero (risk gate)
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
      res.position.exitPlan = defaultExitPlan(
        s.maxHoldMinutes * 60_000,
        0.3,
        s.exitStyle,
        s.spikeExitMultiple,
        s.spikeExitKeepRunnerPct,
      );
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
      positionId: res.position?.id,
      flags: decision.flags?.length ? decision.flags.join(",") : undefined,
    });
    log.info(`paper: bought ${decision.symbol ?? decision.mint.slice(0, 8)} for ${sizeSol.toFixed(3)} SOL`);
    this.svc.hub.broadcast("paper", { action: "buy", mint: decision.mint });
  }

  /** Wired as the paper ExitEngine's onExit — executes the simulated sale.
   *
   *  V5.1 P0 fix (the 54.8-SOL "phantom proceeds" drift): the exit engine
   *  re-fires full exits EVERY tick by design, and this method used to sell from
   *  the CALLER'S stale `pos` snapshot while a previous sell was still awaiting
   *  getSolUsd() — so one position could be fully sold 2-3 times (492 mints sold
   *  more tokens than they ever bought; ~44.8 SOL of cash credited for tokens
   *  that never existed; balance/equity displays were fiction). Now: a
   *  per-position in-flight lock + a FRESH re-read of the position AFTER all
   *  awaits, with amounts computed from the fresh state only. Token conservation
   *  (sold ≤ bought) is restored; re-fired ticks become harmless no-ops. */
  async executeSell(pos: Position, signal: ExitSignal): Promise<void> {
    if (this.selling.has(pos.id)) return; // a sell for this position is already in flight
    this.selling.add(pos.id);
    try {
      const s = this.svc.settings.all();
      const solUsd = await getSolUsd();
      let priceUsd = pos.lastPriceUsd;
      if (!priceUsd) {
        const snap = await this.price(pos.mint);
        priceUsd = snap?.priceUsd;
      }
      if (!priceUsd) return;

      // ALL awaits are done — re-read the position and compute amounts ONLY from
      // current truth. No awaits between here and the wallet credit + reduction,
      // so the credit can never be based on tokens that no longer exist.
      const fresh = this.svc.paperPositions.get(pos.id);
      if (!fresh || fresh.status === "CLOSED" || fresh.tokenAmount <= 0) return;

      const sellTokens = Math.min(fresh.tokenAmount, fresh.tokenAmount * signal.sellPct);
      if (sellTokens <= 0) return;
      const sim = simulateSell(priceUsd, solUsd, sellTokens, s.paperSlippagePct);
      const costFraction = fresh.tokenAmount > 0 ? fresh.solInvested * (sellTokens / fresh.tokenAmount) : 0;
      const realizedSol = sim.solReceived - costFraction;

      this.wallet.credit(sim.solReceived);
      const now = Date.now();
      const priceSol = sim.effPriceUsd / solUsd;
      const res = this.positions.applyActivity(
        { mint: fresh.mint, side: "sell", tokenAmount: sellTokens, solAmount: sim.solReceived, priceSol, at: now, signature: "paper" },
        { symbol: fresh.symbol ?? pos.symbol, solUsd },
      );
      this.svc.paper.recordFill({
        mint: fresh.mint,
        side: "sell",
        priceUsd: sim.effPriceUsd,
        solAmount: sim.solReceived,
        tokenAmount: sellTokens,
        realizedPnlSol: realizedSol,
        remainingTokenAmount: res.position?.tokenAmount ?? 0,
        reason: signal.reason,
        at: now,
        positionId: fresh.id,
      });
      // P0: the position just closed — append the round-trip to the DURABLE
      // realized journal (survives /paper/reset; UNIQUE(position_id) dedupes).
      if (res.marked === "closed" && res.position) {
        try {
          this.journalClose(res.position, signal.reason, sim.effPriceUsd, now);
        } catch (err) {
          log.warn(`paper: realized-journal write failed for #${res.position.id}: ${String(err)}`);
        }
      }
      log.info(`paper: ${signal.kind} ${fresh.symbol ?? fresh.mint.slice(0, 8)} (${realizedSol >= 0 ? "+" : ""}${realizedSol.toFixed(3)} SOL)`);
      this.svc.hub.broadcast("paper", { action: "sell", mint: fresh.mint });
    } finally {
      this.selling.delete(pos.id);
    }
  }

  /** P0: append the just-closed round-trip to the durable realized journal.
   *  Numbers come from THIS position's fills (position_id, v15+). Positions whose
   *  buys predate the column fall back to mint-matched fills inside the position's
   *  lifetime and are marked approx=1 — honest about the reconstruction. */
  private journalClose(pos: Position, exitReason: string | undefined, exitPriceUsd: number, now: number): void {
    let fills = this.svc.paper.fillsForPosition(pos.id);
    let approx = false;
    if (!fills.some((f) => f.side === "buy")) {
      approx = true;
      fills = this.svc.paper
        .fillsForMint(pos.mint, 200)
        .filter((f) => f.at >= pos.entryAtMs - 60_000 && f.at <= now + 1_000 && (f.positionId == null || f.positionId === pos.id));
    }
    const buys = fills.filter((f) => f.side === "buy");
    const sells = fills.filter((f) => f.side === "sell");
    const solInvested = buys.reduce((s, f) => s + f.solAmount, 0);
    const solReturned = sells.reduce((s, f) => s + f.solAmount, 0);
    const realizedPnlSol = sells.reduce((s, f) => s + f.realizedPnlSol, 0);
    this.svc.realized.record({
      positionId: pos.id,
      mint: pos.mint,
      symbol: pos.symbol,
      verdict: buys[0]?.reason,
      flags: buys.find((f) => f.flags)?.flags,
      openedAt: pos.entryAtMs,
      closedAt: now,
      holdMs: now - pos.entryAtMs,
      entryPriceUsd: pos.entryPriceUsd,
      exitPriceUsd,
      peakMultiple: pos.entryPriceUsd > 0 ? pos.peakPriceUsd / pos.entryPriceUsd : undefined,
      solInvested,
      solReturned,
      realizedPnlSol,
      realizedPnlPct: solInvested > 0 ? (realizedPnlSol / solInvested) * 100 : undefined,
      exitReason,
      dd5mPct: this.svc.paper.minPnlPctWithin(pos.id, pos.entryAtMs),
      approx,
      createdAt: now,
    });
  }

  private async price(mint: string): Promise<{ priceUsd?: number; liquidityUsd?: number } | undefined> {
    if (!this.priceLimiter.tryAcquire()) return undefined;
    return fetchDexSnapshot(mint).catch(() => undefined);
  }
}
