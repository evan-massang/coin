import type { Connection } from "@solana/web3.js";
import type { Services } from "../services.js";
import type { PumpPortalClient } from "../sources/pumpPortal.js";
import type { NewToken, Decision, SafetyResult, ScoreBreakdown, TradeEvent } from "../types.js";
import { emptyScores } from "../types.js";
import { SeenCache } from "../util/seenCache.js";
import { RateLimiter } from "../util/rateLimiter.js";
import { metrics } from "../util/metrics.js";
import { log } from "../util/logger.js";
import { TokenStateMachine, type TrackedToken } from "./stateMachine.js";
import { evaluateStage0, evaluateStage1, type Stage0Inputs } from "./safetyGate.js";
import { computeOrganicScore } from "./organicVolume.js";
import { computeMomentum } from "./momentum.js";
import { computeGraduation, progressFromMcapSol } from "./graduation.js";
import { lateEntryRisk } from "../scoring/lateEntry.js";
import { analyzeBundle } from "../checks/bundleInsider.js";
import { computeDevReputation } from "../checks/devReputation.js";
import { computeSmartMoney } from "./smartMoney.js";
import { HypeScorer } from "../hype/HypeScorer.js";
import { fetchSocialScore, heuristicSocial } from "../sources/lunarcrush.js";
import { decide } from "../scoring/decisionCaps.js";
import { thresholdsFromSettings } from "../scoring/thresholds.js";
import { makeConnection } from "../sources/solanaRpc.js";
import { fetchAuthorities } from "../checks/authorities.js";
import { fetchHolderConcentration } from "../checks/holderConcentration.js";
import type { RugcheckReport } from "../sources/rugcheck.js";
import { fetchDexSnapshot } from "../sources/dexscreener.js";

// New-token scanner + full entry pipeline (Phases 2–3).
//   1. New token → Stage-0 hard-kill gate (sub-second). Fail ⇒ AVOID + journal.
//   2. Survivor → OBSERVING; we subscribe to its trade stream and buffer trades.
//   3. After the observation window (or once enough data arrives), score it:
//      Stage-1 safety + organic + momentum + graduation + late-entry → decide().
// Modules not yet built (dev rep, smart money, social, AI hype) default to a
// neutral 50 so they neither force nor block a BUY — Phase 6 replaces them.

export interface EntryHooks {
  /** Fires for every scored decision — paper trading / exit tracking subscribe. */
  onDecision?: (decision: Decision, tracked: TrackedToken) => void;
  onObservedTrade?: (t: TradeEvent, tracked: TrackedToken) => void;
}

export interface EntryOptions {
  observeMs?: number;
  minObserveMs?: number;
  minTradesToScore?: number;
  stage0BudgetMs?: number;
  hooks?: EntryHooks;
}

export class EntryPipeline {
  private readonly seen = new SeenCache();
  readonly sm = new TokenStateMachine();
  private readonly observeMs: number;
  private readonly minObserveMs: number;
  private readonly minTradesToScore: number;
  private readonly stage0BudgetMs: number;
  private readonly hooks: EntryHooks;
  private readonly blacklist = new Set<string>();
  private readonly buffers = new Map<string, TradeEvent[]>();
  private readonly rpcLimiter: RateLimiter;
  private readonly dexLimiter = new RateLimiter(2);
  private readonly hypeScorer: HypeScorer;
  private pruneTimer?: NodeJS.Timeout;
  private scoreTimer?: NodeJS.Timeout;

  constructor(
    private readonly svc: Services,
    private readonly pump: PumpPortalClient,
    opts: EntryOptions = {},
  ) {
    this.observeMs = opts.observeMs ?? 90_000;
    this.minObserveMs = opts.minObserveMs ?? 25_000;
    this.minTradesToScore = opts.minTradesToScore ?? 8;
    this.stage0BudgetMs = opts.stage0BudgetMs ?? 1500;
    this.hooks = opts.hooks ?? {};
    this.rpcLimiter = new RateLimiter(this.svc.settings.get("heliusApiKey") ? 40 : 8);
    this.hypeScorer = new HypeScorer(this.svc.settings);
  }

  start(): void {
    this.pump.on({
      onNewToken: (t) => void this.handleNewToken(t),
      onTrade: (t) => this.handleTrade(t),
    });
    this.pump.start();
    this.pruneTimer = setInterval(() => this.prune(), 60_000);
    this.scoreTimer = setInterval(() => this.scorePass(), 4_000);
    log.ok("entry pipeline started (scanner + Stage-0 gate + observe→score)");
  }

  stop(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.scoreTimer) clearInterval(this.scoreTimer);
    this.pump.stop();
  }

  private prune(): void {
    this.sm.prune();
    // Drop buffers for tokens we no longer track.
    for (const mint of this.buffers.keys()) {
      if (!this.sm.has(mint)) this.buffers.delete(mint);
    }
  }

  private handleTrade(t: TradeEvent): void {
    const tracked = this.sm.get(t.mint);
    if (!tracked) return;
    const buf = this.buffers.get(t.mint);
    if (buf) {
      buf.push(t);
      if (buf.length > 600) buf.shift();
    }
    this.svc.trades.insert(t, "token");
    this.hooks.onObservedTrade?.(t, tracked);
  }

  private async handleNewToken(token: NewToken): Promise<void> {
    const now = Date.now();
    if (!this.seen.add(token.mint, now)) return;
    metrics.inc("tokens_seen");
    this.svc.tokens.upsert(token);
    const tracked = this.sm.track(token, now);

    const t0 = Date.now();
    const { inputs, report } = await this.gatherStage0(token);
    tracked.rugcheck = report;
    const stage0 = evaluateStage0(inputs, {
      maxTopHolderPct: this.svc.settings.get("maxTopHolderPct"),
      minLiquidityUsd: this.svc.settings.get("minLiquidityUsd"),
    });
    metrics.observe("stage0_ms", Date.now() - t0);
    tracked.stage0 = stage0;

    if (!stage0.pass) {
      tracked.phase = "AVOIDED";
      metrics.inc("avoided");
      this.svc.dispatcher.dispatch(this.avoidDecision(token, stage0, now));
      return;
    }

    tracked.phase = "OBSERVING";
    tracked.observeUntil = now + this.observeMs;
    this.buffers.set(token.mint, []);
    metrics.inc("survivors");
    this.pump.watchToken(token.mint);
  }

  /** Periodic scoring of OBSERVING survivors. */
  private scorePass(): void {
    const now = Date.now();
    for (const tracked of this.sm.observing()) {
      const trades = this.buffers.get(tracked.token.mint) ?? [];
      const age = now - tracked.firstSeenAt;
      const windowDone = now >= (tracked.observeUntil ?? 0);
      const enoughData = trades.length >= this.minTradesToScore && age >= this.minObserveMs;
      if (windowDone || enoughData) {
        void this.scoreToken(tracked, trades, now);
      }
    }
  }

  private async scoreToken(tracked: TrackedToken, trades: TradeEvent[], now: number): Promise<void> {
    tracked.phase = "SCORED"; // claim immediately so scorePass doesn't double-fire
    const { token } = tracked;

    const organic = computeOrganicScore(trades);
    const mom = computeMomentum(trades, now);

    const mcaps = trades.map((t) => t.marketCapSol).filter((x): x is number => typeof x === "number");
    const firstMcap = mcaps[0];
    const lastMcap = mcaps[mcaps.length - 1];
    const progress = progressFromMcapSol(lastMcap);
    const spanMin = Math.max((now - tracked.firstSeenAt) / 60_000, 0.1);
    const fillVel = firstMcap && lastMcap && firstMcap > 0 ? (progress - progressFromMcapSol(firstMcap)) / spanMin : 0;
    const grad = computeGraduation(progress, fillVel);

    const priceGainPct = firstMcap && lastMcap && firstMcap > 0 ? (lastMcap / firstMcap - 1) * 100 : 0;
    const late = lateEntryRisk({
      priceGainPctSinceFirstSeen: priceGainPct,
      bondingCurveProgress: progress,
      buyerVelocityTrend: mom.buyerVelocityTrend,
      pullbackSeen: detectPullback(mcaps),
    });

    // Stage-1 safety from observed behaviour.
    const bundle = analyzeBundle(trades);
    const devSold = token.creator
      ? trades.some((t) => t.trader === token.creator && t.side === "sell")
      : undefined;
    const stage1 = evaluateStage1(tracked.stage0!, {
      devWalletSold: devSold,
      freshWalletRatio: organic.freshWalletRatio,
      bundleScore: bundle.bundleScore,
    });
    tracked.stage1 = stage1;

    // Advanced modules (Phase 6).
    const devRep = computeDevReputation({ devSold });
    const smartWallets = new Map<string, number>();
    for (const w of this.svc.wallets.byKind("copy")) smartWallets.set(w.address, w.score?.score ?? 50);
    const smart = computeSmartMoney(trades, smartWallets);
    const hype = await this.hypeScorer.score({ mint: token.mint, name: token.name, symbol: token.symbol });
    const social = await this.socialFor(token.symbol, hype.tags, hype.isRevival);

    const scores: ScoreBreakdown = {
      safety: stage1.score,
      organic: organic.score,
      momentum: mom.score,
      graduation: grad.score,
      devReputation: devRep.score,
      smartMoney: smart.score,
      social: social.score,
      hype: hype.score, // AI narrative — confirmation only (small weight)
      lateEntryRisk: late.risk,
    };

    const reasons = [
      ...mom.reasons.slice(0, 2),
      ...organic.reasons.slice(0, 1),
      ...grad.reasons.slice(0, 1),
      ...(hype.tags.length || hype.isRevival ? [`narrative: ${hype.rationale}`] : []),
      ...smart.reasons.filter((r) => r.includes("bought")),
      ...late.reasons.slice(0, 1),
    ];
    const flags = [...organic.flags];
    if (bundle.detected) flags.push("bundle");
    if (devSold) flags.push("dev-sold");
    if (hype.isRevival) flags.push("revival");

    const decision = decide({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      scores,
      safety: stage1,
      thresholds: thresholdsFromSettings(this.svc.settings.all()),
      reasons,
      flags,
      at: now,
    });
    tracked.lastDecision = decision;
    metrics.inc(`scored_${decision.verdict}`);

    const priceUsd = await this.priceFor(token.mint);
    this.svc.dispatcher.dispatch(decision, { priceAtAlert: priceUsd });
    this.hooks.onDecision?.(decision, tracked);

    // Resource bound: stop metered trade stream for non-BUY outcomes. BUY
    // survivors stay subscribed for the exit engine (Phase 5).
    if (decision.verdict !== "BUY_SMALL" && decision.verdict !== "BUY_STRONG") {
      this.pump.unwatchToken(token.mint);
    }
  }

  private async socialFor(
    symbol: string | undefined,
    tags: string[],
    isRevival: boolean,
  ): Promise<{ score: number }> {
    const key = this.svc.settings.get("lunarcrushApiKey");
    if (key && symbol) {
      const live = await fetchSocialScore(symbol, key).catch(() => undefined);
      if (live) return live;
    }
    return heuristicSocial(tags, isRevival);
  }

  /** Best-effort USD price for the journal (rate-limited; may be undefined). */
  private async priceFor(mint: string): Promise<number | undefined> {
    if (!this.dexLimiter.tryAcquire()) return undefined;
    const snap = await fetchDexSnapshot(mint).catch(() => undefined);
    if (snap) this.svc.tokens.saveSnapshot(snap);
    return snap?.priceUsd;
  }

  private async gatherStage0(token: NewToken): Promise<{ inputs: Stage0Inputs; report?: RugcheckReport }> {
    const settings = this.svc.settings.all();
    const conn: Connection = makeConnection(settings);

    // RugCheck is the primary, keyless safety source — always queried (cached).
    const rugcheckP = withTimeout(
      this.svc.rugcheck.getReport(token.mint, { apiKey: settings.rugcheckApiKey || undefined }),
      this.stage0BudgetMs,
    ).catch(() => undefined);

    // RPC authority cross-check — rate-limited so the public node isn't hammered.
    let authP: Promise<{ mintAuthorityRevoked?: boolean; freezeAuthorityNull?: boolean }>;
    if (this.rpcLimiter.tryAcquire()) {
      authP = withTimeout(fetchAuthorities(conn, token.mint), this.stage0BudgetMs).catch(() => ({}));
    } else {
      metrics.inc("stage0_rpc_skipped");
      authP = Promise.resolve({});
    }

    // RPC holder concentration — only with a Helius key (avoids public-RPC 429s).
    const holdersP: Promise<{ topHolderPct?: number }> = settings.heliusApiKey
      ? withTimeout(fetchHolderConcentration(conn, token.mint), this.stage0BudgetMs).catch(() => ({}))
      : Promise.resolve({});

    const [report, rpcAuth, rpcHolders] = await Promise.all([rugcheckP, authP, holdersP]);

    const inputs: Stage0Inputs = {
      metadata: { name: token.name, symbol: token.symbol, uri: token.uri },
      mintAuthorityRevoked: rpcAuth.mintAuthorityRevoked ?? report?.mintAuthorityRevoked,
      freezeAuthorityNull: rpcAuth.freezeAuthorityNull ?? report?.freezeAuthorityNull,
      deployerBlacklisted: token.creator ? this.blacklist.has(token.creator) : false,
      topHolderPct: rpcHolders.topHolderPct ?? report?.topHolderPct,
      // RugCheck resolves the bundle unknown; a DANGER-level insider/bundle risk
      // (insiderClean=false) is the only thing that flips it true. Stage-1
      // analyzeBundle remains the behavioural authority post-observation.
      bundleDetected: report ? !report.insiderClean : undefined,
      rugcheck: report ? { riskLevel: report.riskLevel, highRisk: report.highRisk, honeypot: report.honeypot } : undefined,
      lp: report ? { liquidityUsd: report.totalLiquidityUsd, lpLockedPct: report.lpLockedPct } : undefined,
    };
    return { inputs, report };
  }

  private avoidDecision(token: NewToken, stage0: SafetyResult, at: number): Decision {
    return decide({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      scores: emptyScores(),
      safety: stage0,
      thresholds: thresholdsFromSettings(this.svc.settings.all()),
      at,
    });
  }
}

/** True if the price (proxied by market cap) pulled back meaningfully at any point. */
function detectPullback(mcaps: number[]): boolean {
  if (mcaps.length < 3) return false;
  let peak = mcaps[0]!;
  for (const m of mcaps) {
    if (m > peak) peak = m;
    if (peak > 0 && (peak - m) / peak >= 0.15) return true; // ≥15% dip from peak
  }
  return false;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}
