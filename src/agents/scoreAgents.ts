import type { Agent } from "./types.js";
import { computeOrganicScore } from "../engine/organicVolume.js";
import { computeMomentum } from "../engine/momentum.js";
import { computeGraduation, progressFromMcapSol } from "../engine/graduation.js";
import { computeDevReputation } from "../checks/devReputation.js";
import { computeSmartMoney } from "../engine/smartMoney.js";
import { heuristicSocial } from "../sources/lunarcrush.js";

// The score-producing agents. Each wraps an existing PURE scorer so values are
// identical to the old inline path — the win is the agent contract: concurrency,
// per-agent timeout/latency, and graceful degradation via the coordinator.

const organicAgent: Agent = {
  id: "organic",
  run: (ctx) => {
    const r = computeOrganicScore(ctx.trades);
    return { score: r.score, confidence: ctx.trades.length >= 8 ? 0.9 : 0.4, reasons: r.reasons.slice(0, 2), data: r };
  },
};

const momentumAgent: Agent = {
  id: "momentum",
  run: (ctx) => {
    const r = computeMomentum(ctx.trades, ctx.now);
    return { score: r.score, confidence: ctx.trades.length >= 8 ? 0.9 : 0.4, reasons: r.reasons.slice(0, 2), data: r };
  },
};

const graduationAgent: Agent = {
  id: "graduation",
  run: (ctx) => {
    const first = ctx.marketCapsSol[0];
    const last = ctx.marketCapsSol[ctx.marketCapsSol.length - 1];
    const progress = progressFromMcapSol(last);
    const spanMin = Math.max((ctx.now - ctx.firstSeenAt) / 60_000, 0.1);
    const fillVel = first && last && first > 0 ? (progress - progressFromMcapSol(first)) / spanMin : 0;
    const r = computeGraduation(progress, fillVel);
    return { score: r.score, confidence: ctx.marketCapsSol.length >= 3 ? 0.8 : 0.3, reasons: r.reasons.slice(0, 1), data: r };
  },
};

const devWalletAgent: Agent = {
  id: "devReputation",
  run: (ctx) => {
    const r = computeDevReputation({ devSold: ctx.devSold });
    return { score: r.score, confidence: 0.5, reasons: r.reasons.slice(0, 1) };
  },
};

const smartMoneyAgent: Agent = {
  id: "smartMoney",
  run: (ctx) => {
    const r = computeSmartMoney(ctx.trades, ctx.smartWallets);
    return { score: r.score, confidence: ctx.smartWallets.size > 0 ? 0.8 : 0.2, reasons: r.reasons.slice(0, 1), data: r };
  },
};

const narrativeAgent: Agent = {
  id: "hype",
  run: async (ctx) => {
    const r = await ctx.hype({ mint: ctx.token.mint, name: ctx.token.name, symbol: ctx.token.symbol });
    const reasons = r.tags.length || r.isRevival ? [`narrative: ${r.rationale}`] : [];
    return { score: r.score, confidence: 0.6, reasons, data: r };
  },
};

// social re-uses the (cached) hype result for its tags, so a second ctx.hype
// call is a cache hit — no extra API spend.
const socialAgent: Agent = {
  id: "social",
  run: async (ctx) => {
    const h = await ctx.hype({ mint: ctx.token.mint, name: ctx.token.name, symbol: ctx.token.symbol });
    const r = heuristicSocial(h.tags, h.isRevival);
    return { score: r.score, confidence: 0.4, reasons: r.reasons.slice(0, 1) };
  },
};

export const SCORE_AGENTS: Agent[] = [
  organicAgent,
  momentumAgent,
  graduationAgent,
  devWalletAgent,
  smartMoneyAgent,
  narrativeAgent,
  socialAgent,
];
