// Project Athena Phase 17/22 — Decision Authority audit. Answers, per executed paper
// buy, "which intelligence authorized this?" and proves the engine's standing claim:
// when the Readiness Gate is on, NO buy reaches the wallet without attention research.
// Pure + testable; the route feeds it live positions + the durable attention store +
// the metric counters.

export interface AuthorityBuyInput {
  mint: string;
  symbol?: string;
  entryAtMs: number;
}

/** Latest durable attention record per mint (mint -> the fields we report). */
export interface AuthorityResearch {
  at: number;
  attention: number;
  confidence: number;
}

export interface BuyAuthority {
  mint: string;
  symbol?: string;
  entryAtMs: number;
  researched: boolean;
  attention?: number;
  confidence?: number;
  researchAt?: number;
  /** Best-effort: did the latest research land at/before the buy? (The durable store
   *  keeps only the newest record per mint, so a post-buy TTL refresh can flip this to
   *  false for a buy that WAS gated — hence informational, not a violation by itself.) */
  researchBeforeBuy?: boolean;
}

export interface AuthorityCounters {
  /** Buys that executed via the normal pre-research path (should be 0 when gate on). */
  scoredBuys: number;
  /** Buys that executed via the attention re-score upgrade (the gated path). */
  attentionGatedBuys: number;
}

export interface AuthorityReport {
  gateOn: boolean;
  total: number;
  researched: number;
  unresearched: number;
  pctResearched: number;
  /** THE invariant: when the gate is on, no buy may bypass attention via the normal
   *  path. True iff (gate off) OR (scoredBuys === 0). A false here is a silent bypass. */
  noSilentBypass: boolean;
  counters: AuthorityCounters;
  buys: BuyAuthority[];
}

export function auditAuthority(input: {
  gateOn: boolean;
  buys: AuthorityBuyInput[];
  research: Map<string, AuthorityResearch>;
  counters: AuthorityCounters;
}): AuthorityReport {
  const buys: BuyAuthority[] = input.buys.map((b) => {
    const r = input.research.get(b.mint);
    return {
      mint: b.mint,
      symbol: b.symbol,
      entryAtMs: b.entryAtMs,
      researched: r !== undefined,
      attention: r?.attention,
      confidence: r?.confidence,
      researchAt: r?.at,
      researchBeforeBuy: r ? r.at <= b.entryAtMs : undefined,
    };
  });
  const researched = buys.filter((b) => b.researched).length;
  const total = buys.length;
  // When the gate is ON, the only way a buy reaches the wallet is the attention
  // re-score upgrade, so the legacy pre-research counter must be zero.
  const noSilentBypass = !input.gateOn || input.counters.scoredBuys === 0;
  return {
    gateOn: input.gateOn,
    total,
    researched,
    unresearched: total - researched,
    pctResearched: total ? researched / total : 0,
    noSilentBypass,
    counters: input.counters,
    buys,
  };
}
