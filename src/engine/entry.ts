import type { Connection } from "@solana/web3.js";
import type { Services } from "../services.js";
import type { PumpPortalClient } from "../sources/pumpPortal.js";
import type { NewToken, Decision, SafetyResult, ScoreBreakdown, TradeEvent, HypeResult, GraphIntel } from "../types.js";
import { emptyScores } from "../types.js";
import { SeenCache } from "../util/seenCache.js";
import { RateLimiter } from "../util/rateLimiter.js";
import { metrics } from "../util/metrics.js";
import { withTimeout } from "../util/withTimeout.js";
import { log } from "../util/logger.js";
import { TokenStateMachine, type TrackedToken } from "./stateMachine.js";
import { evaluateStage0, evaluateStage1, type Stage0Inputs } from "./safetyGate.js";
import { lateEntryRisk } from "../scoring/lateEntry.js";
import { analyzeBundle } from "../checks/bundleInsider.js";
import { HypeScorer } from "../hype/HypeScorer.js";
import { runAgents, scoreOf } from "../agents/coordinator.js";
import { SCORE_AGENTS } from "../agents/scoreAgents.js";
import { fetchMarketWeather } from "../agents/marketWeather.js";
import { computeSourceAgreement } from "../agents/sourceAgreement.js";
import { fingerprintToken, isSimilarToRug } from "../graph/tokenSimilarity.js";
import { deployerReputation } from "../graph/deployerGraph.js";
import { clusterRisk } from "../graph/walletClusterGraph.js";
import { computeGraphIntelligence } from "../graph/graphIntelligence.js";
import type { OrganicResult } from "./organicVolume.js";
import type { MomentumResult } from "./momentum.js";
import type { GraduationResult } from "./graduation.js";
import { decide } from "../scoring/decisionCaps.js";
import { thresholdsFromSettings } from "../scoring/thresholds.js";
import { computeRisk } from "../risk/microfishRisk.js";
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
  // Bound concurrent token-trade subscriptions — the free PumpPortal feed drops
  // the trade stream when over-subscribed. Survivors over the cap still score on
  // their seeded launch data.
  private readonly maxWatched = 50;
  private readonly watched = new Set<string>();
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
    // Drop buffers + free watch slots for tokens we no longer track.
    for (const mint of this.buffers.keys()) {
      if (!this.sm.has(mint)) this.buffers.delete(mint);
    }
    for (const mint of this.watched) {
      if (!this.sm.has(mint)) {
        this.watched.delete(mint);
        this.pump.unwatchToken(mint);
      }
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

    // Scam memory: record the launch + a token fingerprint (Phase 5).
    if (token.creator) this.svc.creatorHistory.recordLaunch(token.creator, now);
    this.svc.fingerprints.record(token.mint, fingerprintToken({ name: token.name, symbol: token.symbol, uri: token.uri }), now);

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
    // Seed the buffer with the creator's initial buy (it rides in the "create"
    // event, not the trade stream) so momentum/organic/graduation have launch
    // data even for quiet tokens.
    const seed: TradeEvent[] = [];
    if (token.initialBuySol && token.initialBuySol > 0) {
      seed.push({
        mint: token.mint,
        trader: token.creator ?? "creator",
        side: "buy",
        solAmount: token.initialBuySol,
        marketCapSol: token.marketCapSol,
        at: now,
      });
    }
    this.buffers.set(token.mint, seed);
    metrics.inc("survivors");
    // Only subscribe to the live trade stream if under the cap.
    if (this.watched.size < this.maxWatched) {
      this.watched.add(token.mint);
      this.pump.watchToken(token.mint);
    }
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

    const mcaps = trades.map((t) => t.marketCapSol).filter((x): x is number => typeof x === "number");
    const firstMcap = mcaps[0];
    const lastMcap = mcaps[mcaps.length - 1];
    const priceGainPct = firstMcap && lastMcap && firstMcap > 0 ? (lastMcap / firstMcap - 1) * 100 : 0;

    const bundle = analyzeBundle(trades);
    const devSold = token.creator
      ? trades.some((t) => t.trader === token.creator && t.side === "sell")
      : undefined;
    const smartWallets = new Map<string, number>();
    for (const w of this.svc.wallets.byKind("copy")) smartWallets.set(w.address, w.score?.score ?? 50);

    // Phase 3: run the scoring facets as concurrent agents (the coordinator
    // never throws; a slow/failed agent degrades to a neutral unknown).
    const results = await runAgents(SCORE_AGENTS, {
      token,
      trades,
      now,
      firstSeenAt: tracked.firstSeenAt,
      marketCapsSol: mcaps,
      rugcheck: tracked.rugcheck,
      devSold,
      smartWallets,
      hype: (t) => this.hypeScorer.score(t),
    });
    const organicData = results.get("organic")?.data as OrganicResult | undefined;
    const momData = results.get("momentum")?.data as MomentumResult | undefined;
    const gradData = results.get("graduation")?.data as GraduationResult | undefined;
    const hypeData = results.get("hype")?.data as HypeResult | undefined;

    const stage1 = evaluateStage1(tracked.stage0!, {
      devWalletSold: devSold,
      freshWalletRatio: organicData?.freshWalletRatio,
      bundleScore: bundle.bundleScore,
    });
    tracked.stage1 = stage1;

    const late = lateEntryRisk({
      priceGainPctSinceFirstSeen: priceGainPct,
      bondingCurveProgress: gradData?.progress ?? 0,
      buyerVelocityTrend: momData?.buyerVelocityTrend ?? 0,
      pullbackSeen: detectPullback(mcaps),
    });

    const scores: ScoreBreakdown = {
      safety: stage1.score,
      organic: scoreOf(results, "organic"),
      momentum: scoreOf(results, "momentum"),
      graduation: scoreOf(results, "graduation"),
      devReputation: scoreOf(results, "devReputation"),
      smartMoney: scoreOf(results, "smartMoney"),
      social: scoreOf(results, "social"),
      hype: scoreOf(results, "hype"), // AI narrative — confirmation only (small weight)
      lateEntryRisk: late.risk,
    };

    const reasons = [
      ...(momData?.reasons ?? []).slice(0, 2),
      ...(organicData?.reasons ?? []).slice(0, 1),
      ...(gradData?.reasons ?? []).slice(0, 1),
      ...(hypeData && (hypeData.tags.length || hypeData.isRevival) ? [`narrative: ${hypeData.rationale}`] : []),
      ...late.reasons.slice(0, 1),
    ];
    const flags = [...(organicData?.flags ?? [])];
    if (bundle.detected) flags.push("bundle");
    if (devSold) flags.push("dev-sold");
    if (hypeData?.isRevival) flags.push("revival");

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
    // Phase 4: market weather (macro + the engine's own win rate) + source
    // agreement (do independent signals corroborate or conflict?).
    const s = this.svc.settings.all();
    const weather = await fetchMarketWeather(() => {
      const st = this.svc.signals.stats();
      return { winRate: st.winRate, samples: st.total };
    }, s.riskOffMultiplier);
    const agreement = computeSourceAgreement({
      rugcheckClean: tracked.rugcheck ? !tracked.rugcheck.highRisk && tracked.rugcheck.riskLevel !== "danger" : undefined,
      bundleBad: bundle.detected,
      liquidityHealthy: (tracked.rugcheck?.totalLiquidityUsd ?? 0) >= s.minLiquidityUsd,
      holderBad: tracked.rugcheck?.topHolderPct !== undefined ? tracked.rugcheck.topHolderPct > s.maxTopHolderPct : false,
      momentumStrong: scores.momentum >= 70,
      sourceConflictMultiplier: s.sourceConflictMultiplier,
    });

    // Phase 5 scam memory: deployer reputation × rug-relaunch similarity ×
    // buyer-cluster overlap.
    const deployer = deployerReputation(token.creator ? this.svc.creatorHistory.get(token.creator) : undefined);
    const sim = isSimilarToRug({ name: token.name, symbol: token.symbol, uri: token.uri }, this.svc.fingerprints.pastRugs());
    const buyers = [...new Set(trades.filter((t) => t.side === "buy").map((t) => t.trader).filter(Boolean))];
    this.svc.walletCluster.recordCoBuy(buyers, now);
    const cluster = clusterRisk(this.svc.walletCluster.rugOverlap(buyers));
    const scamMemoryMultiplier = deployer.multiplier * sim.multiplier * cluster.multiplier;

    // MiroFish dynamic risk sizing (advisory / paper-only).
    const risk = computeRisk({
      verdict: decision.verdict,
      conviction: decision.conviction,
      scores,
      safetyPass: stage1.pass,
      unknownCount: stage1.unknownCount,
      honeypot: tracked.rugcheck?.honeypot,
      liquidityUsd: tracked.rugcheck?.totalLiquidityUsd,
      minLiquidityUsd: s.minLiquidityUsd,
      marketWeatherMultiplier: weather.multiplier,
      sourceAgreementMultiplier: agreement.multiplier,
      scamMemoryMultiplier,
      baseRiskPct: s.baseRiskPct,
      maxRiskPct: s.maxRiskPct,
      minRiskPct: s.minRiskPct,
      maxPositionSol: s.paperMaxPositionSol,
    });
    decision.riskTier = risk.riskTier;
    decision.suggestedRiskPct = risk.suggestedRiskPct;
    decision.maxPositionSol = risk.maxPositionSol;
    decision.marketWeather = weather.weather;
    decision.sourceAgreement = agreement.score;
    const scamFlags = [
      ...deployer.reasons,
      ...(sim.similar ? [`name matches past rug "${sim.match}"`] : []),
      ...cluster.reasons,
    ];
    decision.redFlags = [...flags, ...agreement.conflicts, ...scamFlags].slice(0, 5);

    // Graph Intelligence Layer: turn the observation into the operator question —
    // *why* does the engine believe (or doubt) this token? Builds the entity
    // graph, bull/bear evidence, coverage, observation state + timeline. Pure;
    // attaches a summary to the decision and stashes the full intel for detail panels.
    const fp = fingerprintToken({ name: token.name, symbol: token.symbol, uri: token.uri });
    const intel = computeGraphIntelligence({
      mint: token.mint,
      symbol: token.symbol,
      creator: token.creator,
      scores,
      safety: stage1,
      verdict: decision.verdict,
      conviction: decision.conviction,
      devSold,
      bundle: bundle.detected,
      rugMatch: sim.similar,
      similarWinners: this.svc.fingerprints.similarWinners(fp.normName),
      deployerLaunches: token.creator ? this.svc.creatorHistory.get(token.creator)?.launches : undefined,
      liquidityUsd: tracked.rugcheck?.totalLiquidityUsd,
      tradeCount: trades.length,
      firstSeenAt: tracked.firstSeenAt,
      now,
    });
    decision.state = intel.state;
    decision.coverage = intel.coverage;
    decision.convictionTier = intel.convictionTier;
    decision.evidenceCount = intel.bull.length + intel.bear.length;
    decision.bullCount = intel.bull.length;
    decision.bearCount = intel.bear.length;
    this.recordIntel(intel);

    tracked.lastDecision = decision;
    metrics.inc(`scored_${decision.verdict}`);

    const priceUsd = await this.priceFor(token.mint);
    this.svc.dispatcher.dispatch(decision, { priceAtAlert: priceUsd });
    this.hooks.onDecision?.(decision, tracked);

    // Resource bound: stop metered trade stream for non-BUY outcomes (freeing a
    // subscription slot). BUY survivors stay subscribed for the exit engine.
    if (decision.verdict !== "BUY_SMALL" && decision.verdict !== "BUY_STRONG") {
      if (this.watched.delete(token.mint)) this.pump.unwatchToken(token.mint);
    }
  }

  /** Stash the latest graph intel (bounded LRU) + refresh engine-state tiles. */
  private recordIntel(intel: GraphIntel): void {
    const map = this.svc.runtime.intel;
    map.delete(intel.mint); // re-insert to keep Map insertion-order as LRU
    map.set(intel.mint, intel);
    while (map.size > 200) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
    // Engine-state tiles are a LIVE snapshot, not running totals: tokens we're
    // observing right now + recent (≤30m) decision/conviction/risk activity.
    const recent = [...map.values()].filter((x) => intel.at - x.at <= 30 * 60_000);
    this.svc.runtime.engineState = {
      observing: [...this.sm.observing()].length,
      decisionReady: recent.filter((x) => x.state === "DECISION_READY").length,
      highConviction: recent.filter((x) => x.convictionTier === "HIGH").length,
      highRisk: recent.filter((x) => x.bearScore > x.bullScore).length,
    };
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
