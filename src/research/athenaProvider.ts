import type { ResearchProvider, ResearchResult } from "./researchProvider.js";
import type { CoinRef } from "../attention/attentionService.js";
import type { AttentionEvidence, AttentionScores } from "../attention/types.js";
import { collectEvidence } from "../attention/researchAgent.js";
import { computeAttention } from "../attention/attentionAgent.js";

// The local Athena collector + scorer, exposed as a ResearchProvider. This is the
// engine's verified-working attention read (free News+Wikipedia collection +
// four pure agents, optional local-LLM judge) and the ALWAYS-AVAILABLE fallback:
// it is the evidence source the readiness gate keys on, so it stays gate-critical
// and must not be removed without a proven replacement (Rule 7).

export interface AthenaProviderOpts {
  /** Collect public evidence (default: free News+Wiki collector). */
  collect?: (c: CoinRef) => Promise<AttentionEvidence>;
  /** Score the evidence (default: heuristic; pass makeScorer(...) for the LLM judge). */
  score?: (ev: AttentionEvidence) => Promise<{ scores: AttentionScores; source: "heuristic" | "llm" }>;
}

export class AthenaProvider implements ResearchProvider {
  readonly name = "athena";
  private readonly collect: (c: CoinRef) => Promise<AttentionEvidence>;
  private readonly score: (ev: AttentionEvidence) => Promise<{ scores: AttentionScores; source: "heuristic" | "llm" }>;

  constructor(opts: AthenaProviderOpts = {}) {
    this.collect = opts.collect ?? ((c) => collectEvidence(c, {}));
    this.score = opts.score ?? (async (ev) => ({ scores: computeAttention(ev), source: "heuristic" as const }));
  }

  /** Local + deterministic — always ready. */
  available(): boolean {
    return true;
  }

  async research(coin: CoinRef): Promise<ResearchResult> {
    const evidence = await this.collect(coin);
    const { scores, source } = await this.score(evidence);
    return { scores, evidence, source, provider: this.name };
  }
}
