import type { Connection } from "@solana/web3.js";
import type { Services } from "../services.js";
import type { PumpPortalClient } from "../sources/pumpPortal.js";
import type { NewToken, Decision, SafetyResult, ScoreBreakdown, TradeEvent, HypeResult, GraphIntel, MarketSnapshot } from "../types.js";
import { dexSignals } from "./dexMomentum.js";
import { emptyScores } from "../types.js";
import { SeenCache } from "../util/seenCache.js";
import { RateLimiter } from "../util/rateLimiter.js";
import { metrics } from "../util/metrics.js";
import { withTimeout } from "../util/withTimeout.js";
import { log } from "../util/logger.js";
import { TokenStateMachine, type TrackedToken } from "./stateMachine.js";
import { pickWatchVictim, type WatchSlot } from "./watchAllocator.js";
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
import { classifyRegime } from "../graph/marketRegime.js";
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
    // Observe-longer maturity gate (Cycle 7): decide on 2-5min-mature coins, not
    // seconds-old newborns. Settings-driven (tunable in CONFIG); opts win in tests.
    this.observeMs = opts.observeMs ?? this.svc.settings.get("observeWindowSec") * 1000;
    this.minObserveMs = opts.minObserveMs ?? this.svc.settings.get("minObserveSec") * 1000;
    this.minTradesToScore = opts.minTradesToScore ?? 8;
    this.stage0BudgetMs = opts.stage0BudgetMs ?? 1500;
    this.hooks = opts.hooks ?? {};
    this.rpcLimiter = new RateLimiter(this.svc.settings.get("heliusApiKey") ? 40 : 8);
    this.hypeScorer = new HypeScorer(this.svc.settings);
  }

  start(): void {
    // Expose tracking state to read-only consumers (the mission board reports
    // honestly whether a pasted result can still re-score a coin), and the
    // injection hook Manus discovery uses to hand candidates to this pipeline.
    this.svc.runtime.isTracked = (mint: string) => this.sm.has(mint);
    this.svc.runtime.injectToken = (t) => this.injectToken(t);
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

  /** Inject a token discovered by an ALTERNATE source (the DexScreener
   *  maturing-survivor scanner) into the same observe→score pipeline. The token
   *  carries discoverySource:"scan" so the decision is tagged + (in shadow) not bought. */
  injectToken(token: NewToken): void {
    void this.handleNewToken(token);
  }

  /** Project Athena Phase 17/21 — re-decide a coin once attention research completes.
   *  Re-runs decide() with the new attention facet. If the readiness gate had held a
   *  would-be buy at WATCH (no research yet), and attention now confirms a BUY, this
   *  recomputes risk sizing and EXECUTES the attention-informed buy — so attention
   *  genuinely gates the executed trade. Only executes on a non-buy→buy UPGRADE, so a
   *  coin already bought via the normal path is never double-filled.
   *  Returns an HONEST status (V5.1 audit fix — callers used to claim "rescored"
   *  even when the token was pruned and nothing happened). */
  async rescoreWithAttention(
    mint: string,
    att: { attention: number; confidence: number; narrative: string },
    source?: string,
  ): Promise<"untracked" | "unchanged" | "rescored" | "executed"> {
    const t = this.sm.get(mint);
    if (!t?.lastDecision || !t.stage1 || !t.lastConfidence) return "untracked";
    const prev = t.lastDecision;
    const s = this.svc.settings.all();
    // Carry forward the prior flags but DROP "awaiting-attention" — research has now
    // run, so that hold no longer applies; leaving it would mislabel the re-scored
    // decision as still waiting. Dedupe so repeated scores don't stack duplicates.
    // Research-source provenance (V5.1 audit fix): tag the decision with WHO
    // produced the attention read ("research:manus" / "research:heuristic"), so a
    // journalled BUY is attributable to its researcher forever.
    const carriedFlags = [
      ...new Set([
        ...(prev.flags ?? []).filter((f) => f !== "awaiting-attention" && !f.startsWith("research:")),
        ...(source ? [`research:${source}`] : []),
      ]),
    ];
    const decision = decide({
      mint,
      symbol: prev.symbol,
      name: prev.name,
      scores: { ...prev.scores, attention: att.attention },
      safety: t.stage1,
      thresholds: thresholdsFromSettings(s),
      reasons: prev.reasons,
      flags: carriedFlags,
      confidence: { ...t.lastConfidence, attention: att.confidence },
      convictionFloor: s.convictionConfidenceFloor,
      minRealCoverage: s.minRealCoverage,
      attentionResearched: true, // we are HERE because research just completed
      at: Date.now(),
    });
    const changed = decision.verdict !== prev.verdict || Math.abs(decision.conviction - prev.conviction) >= 3;
    if (!changed) {
      t.lastDecision = { ...prev, scores: decision.scores }; // keep attention score visible
      return "unchanged";
    }
    const nowBuy = decision.verdict === "BUY_SMALL" || decision.verdict === "BUY_STRONG";
    const wasBuy = prev.verdict === "BUY_SMALL" || prev.verdict === "BUY_STRONG";
    // Recompute risk sizing. A gated WATCH was sized 0% (computeRisk returns NONE for
    // a non-BUY), so an attention-upgraded BUY MUST resize or it would execute at zero.
    // Reuse the verdict-independent inputs captured at score time (weather brake,
    // source-agreement, scam-memory all preserved). Fall back to the prior advisory
    // sizing if the base wasn't captured.
    if (nowBuy && t.lastRiskBase) {
      const risk = computeRisk({ verdict: decision.verdict, conviction: decision.conviction, scores: decision.scores, ...t.lastRiskBase });
      decision.riskTier = risk.riskTier;
      decision.suggestedRiskPct = risk.suggestedRiskPct;
      decision.maxPositionSol = risk.maxPositionSol;
    } else {
      decision.riskTier = prev.riskTier;
      decision.suggestedRiskPct = prev.suggestedRiskPct;
      decision.maxPositionSol = prev.maxPositionSol;
    }
    decision.state = prev.state;
    decision.coverage = prev.coverage;
    decision.reasons = [`attention re-score (${prev.verdict}→${decision.verdict}): ${att.narrative}`, ...decision.reasons].slice(0, 6);
    t.lastDecision = decision;
    metrics.inc(`rescore_${decision.verdict}`);
    // Price the re-scored signal (V5.1 P0 fix). This dispatch used to omit
    // priceAtAlert, so EVERY rescored signal — including every attention-gated
    // executed buy — journalled with a NULL price and was permanently invisible
    // to the OutcomeTracker, buyStats/market-weather, and the learning loop: the
    // engine was calibrating on a population it no longer trades. Fetched
    // directly (not via the shared limiter) because re-scores are rare and this
    // price is what makes the trade measurable at all.
    const snap = await fetchDexSnapshot(mint).catch(() => undefined);
    if (snap) this.svc.tokens.saveSnapshot(snap);
    decision.pairCreatedAt = snap?.pairCreatedAt ?? prev.pairCreatedAt;
    this.svc.dispatcher.dispatch(decision, { priceAtAlert: snap?.priceUsd });
    // EXECUTE only on a genuine non-buy→buy UPGRADE — this is what makes attention
    // GATE the executed trade (the readiness gate held the buy at WATCH until research
    // landed). A coin already bought via the normal path (wasBuy) is never double-filled,
    // and an already-open paper position (e.g. carried across a restart) is never
    // averaged into.
    if (nowBuy && !wasBuy && !this.svc.paperPositions.openByMint(mint)) {
      this.hooks.onDecision?.(decision, t);
      metrics.inc("attention_gated_buy");
      return "executed";
    }
    return "rescored";
  }

  private prune(): void {
    this.sm.prune();
    // Drop buffers + free watch slots for tokens we no longer track.
    for (const mint of this.buffers.keys()) {
      if (!this.sm.has(mint)) this.buffers.delete(mint);
    }
    for (const mint of [...this.watched]) {
      if (!this.sm.has(mint)) this.unwatch(mint);
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
    this.admitToWatch(token.mint, now);
  }

  private watch(mint: string): void {
    if (this.watched.has(mint)) return;
    this.watched.add(mint);
    this.pump.watchToken(mint);
  }

  private unwatch(mint: string): void {
    if (this.watched.delete(mint)) this.pump.unwatchToken(mint);
  }

  /**
   * Give this survivor a live trade-stream slot. If the cap is full and recycling
   * is enabled, EVICT the deadest eligible slot (fewest trades, past min-tenure,
   * still below the sufficiency threshold so an active token is never evicted) so
   * the fresh survivor can actually accumulate enough trades to earn a verdict.
   * Demand-driven + bounded to maxWatched ⇒ feed-safe. (Cycle 3.)
   */
  private admitToWatch(mint: string, now: number): void {
    if (this.watched.has(mint)) return;
    if (this.watched.size < this.maxWatched) { this.watch(mint); return; }
    if (!this.svc.settings.get("adaptiveWatchEnabled")) return; // legacy: no slot, scores on seed
    const slots: WatchSlot[] = [];
    for (const w of this.watched) {
      const tracked = this.sm.get(w);
      if (!tracked) continue;
      const buf = this.buffers.get(w) ?? [];
      slots.push({ mint: w, age: now - tracked.firstSeenAt, trades: buf.length, lastTradeAt: buf.length ? buf[buf.length - 1]!.at : tracked.firstSeenAt });
    }
    const victim = pickWatchVictim(slots, this.minObserveMs, this.minTradesToScore);
    if (victim) { this.unwatch(victim); this.watch(mint); metrics.inc("watch_recycled"); }
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

    const s = this.svc.settings.all();
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
      minBuys: s.minBuysToDecide,
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

    // Cycle 4: the PumpPortal per-trade stream is a PAID feature the engine doesn't
    // buy (0.01 SOL/10k events), so the trade buffer is empty and organic/momentum
    // are blind. Derive them for FREE from DexScreener's rolling 5m buy/sell + price
    // aggregates — and because that window is DexScreener's own, observing longer
    // does NOT deflate it (unlike now−start trade-stream momentum). Fetched BEFORE
    // late-entry so the guard sees the REAL run-up (m5/h1), not the empty buffer.
    let dexSnap: MarketSnapshot | undefined;
    if (s.dexFallbackEnabled && this.dexLimiter.tryAcquire()) {
      dexSnap = await fetchDexSnapshot(token.mint).catch(() => undefined);
      if (dexSnap) this.svc.tokens.saveSnapshot(dexSnap);
    }
    const dex = dexSignals(dexSnap, s.minBuysToDecide);

    // Late-entry "don't chase" guard. Its run-up input was historically the trade
    // buffer's marketCap delta — empty on the free feed, so the guard NEVER fired
    // (0/19k TOO_LATE; risk capped at 40 < 70 threshold). Now ALSO fed DexScreener
    // m5/h1 price change so it can see a coin that already ran. SHADOW by default
    // (records the risk + flags "would block", does not change the verdict) until
    // forward run-up→outcome data calibrates the threshold (see lateEntryEnforce).
    const late = lateEntryRisk({
      priceGainPctSinceFirstSeen: priceGainPct,
      bondingCurveProgress: gradData?.progress ?? 0,
      buyerVelocityTrend: momData?.buyerVelocityTrend ?? 0,
      pullbackSeen: detectPullback(mcaps),
      recentPriceChangeM5Pct: dexSnap?.priceChange?.m5,
      recentPriceChangeH1Pct: dexSnap?.priceChange?.h1,
    });

    // Attention Intelligence (Project Athena): cached research result, if the coin
    // was already shortlisted + researched. Confidence is 0 when unresearched ⇒ the
    // facet is dropped from the conviction blend (blind newborns are unaffected).
    const att = this.svc.attention?.get(token.mint);
    const scores: ScoreBreakdown = {
      safety: stage1.score,
      organic: dex.confident ? dex.organic : scoreOf(results, "organic"),
      momentum: dex.confident ? dex.momentum : scoreOf(results, "momentum"),
      graduation: scoreOf(results, "graduation"),
      devReputation: scoreOf(results, "devReputation"),
      smartMoney: scoreOf(results, "smartMoney"),
      social: scoreOf(results, "social"),
      hype: scoreOf(results, "hype"), // AI narrative — confirmation only (small weight)
      lateEntryRisk: late.risk,
      // Decision-time run-up context (observability + iteration-2 calibration data).
      recentM5Pct: dexSnap?.priceChange?.m5,
      recentH1Pct: dexSnap?.priceChange?.h1,
      attention: att?.attention ?? 0,
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
    if (tracked.token.discoverySource === "scan") flags.push("src:scan"); // maturing-survivor scanner (A/B + shadow)
    if (tracked.token.discoverySource === "manus") flags.push("src:manus"); // Manus discovery candidate (Hermes Phase 3)

    // Per-facet confidence: unknown agents (couldn't compute) are dropped from the
    // conviction blend rather than anchoring it at a frozen default (Cycle 1 fix).
    const conf = (id: string): number => { const r = results.get(id); return r?.unknown ? 0 : (r?.confidence ?? 1); };
    const confidence = {
      organic: dex.confident ? 0.9 : conf("organic"), momentum: dex.confident ? 0.9 : conf("momentum"), graduation: conf("graduation"),
      devReputation: conf("devReputation"), smartMoney: conf("smartMoney"), social: conf("social"), hype: conf("hype"),
      attention: att?.confidence ?? 0,
    };
    if (dex.confident) reasons.unshift(`dex: ${dex.txns5m} txns/5m, buy-pressure organic ${dex.organic}`);

    const decision = decide({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      scores,
      safety: stage1,
      thresholds: thresholdsFromSettings(s),
      reasons,
      flags,
      confidence,
      convictionFloor: s.convictionConfidenceFloor,
      minRealCoverage: s.minRealCoverage,
      // Readiness gate (Phase 21): research has run iff we already hold a record.
      attentionResearched: att !== undefined,
      at: now,
    });
    // Phase 4: market weather (macro + the engine's own win rate) + source
    // agreement (do independent signals corroborate or conflict?).
    const wxStats = this.svc.signals.stats();
    // Weather's "is THIS engine working" signal must come from REAL trades only
    // (resolved BUYs) — feeding it the all-signal win-rate (dominated by
    // never-traded WATCH/AVOID tokens, ~1%) forced a permanent false RISK_OFF
    // that floored every BUY to TINY size. Macro-only until ≥minWeatherSamples
    // resolved BUYs exist, after which the real BUY win-rate re-engages the brake.
    const buyStats = this.svc.signals.buyStats();
    const weather = await fetchMarketWeather(
      () => ({ winRate: buyStats.winRate, samples: buyStats.samples }),
      s.riskOffMultiplier,
      now,
      s.minWeatherSamples,
    );
    // Classify + record the regime at decision time (research enablement; headless-safe).
    const wxBuys = (wxStats.byVerdict.BUY_SMALL ?? 0) + (wxStats.byVerdict.BUY_STRONG ?? 0);
    decision.regime = classifyRegime({
      weather: weather.weather,
      buyRate: wxStats.total ? wxBuys / wxStats.total : 0,
      avoidRate: wxStats.total ? (wxStats.byVerdict.AVOID ?? 0) / wxStats.total : 0,
    }).regime;
    this.svc.runtime.marketRegime = decision.regime;
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

    // MiroFish dynamic risk sizing (advisory / paper-only). The verdict-independent
    // inputs are stashed on the tracked token so the attention re-score can RECOMPUTE
    // sizing if it upgrades a gated WATCH (sized 0%) to a real BUY.
    const riskBase = {
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
    };
    tracked.lastRiskBase = riskBase;
    const risk = computeRisk({ verdict: decision.verdict, conviction: decision.conviction, scores, ...riskBase });
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
      minLiquidityUsd: s.minLiquidityUsd,
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
    // True coin age (Phase 0/16 data-truth fix): DexScreener's pairCreatedAt is the
    // only free source of a coin's real birth time. When absent (pre-graduation), the
    // UI honestly falls back to signal recency rather than mislabeling it as age.
    decision.pairCreatedAt = dexSnap?.pairCreatedAt;
    this.recordIntel(intel);

    tracked.lastDecision = decision;
    tracked.lastConfidence = confidence; // for attention re-score (Athena Phase 17)
    metrics.inc(`scored_${decision.verdict}`);

    const priceUsd = dexSnap?.priceUsd ?? (await this.priceFor(token.mint));
    this.svc.dispatcher.dispatch(decision, { priceAtAlert: priceUsd });
    this.hooks.onDecision?.(decision, tracked);

    // Project Athena: auto-research shortlisted coins (WATCH/BUY — never AVOID).
    // Async + cached; rescoreWithAttention() re-decides this coin when it completes.
    if (decision.verdict === "WATCH_ONLY" || decision.verdict === "BUY_SMALL" || decision.verdict === "BUY_STRONG") {
      this.svc.attention?.request({ mint: token.mint, symbol: token.symbol, name: token.name, verdict: decision.verdict });
    }

    // Resource bound: stop metered trade stream for non-BUY outcomes (freeing a
    // subscription slot). BUY survivors stay subscribed for the exit engine.
    if (decision.verdict !== "BUY_SMALL" && decision.verdict !== "BUY_STRONG") {
      this.unwatch(token.mint);
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
