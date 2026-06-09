import type { CoinRef } from "../attention/attentionService.js";
import type { AttentionEvidence, AttentionScores } from "../attention/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Project Hermes — pluggable research backend ("who answers WHY humans care?").
//
// The engine COLLECTS evidence and DELEGATES the attention read to a provider.
// Every provider is ADVISORY BY CONSTRUCTION: its ResearchResult flows back
// through AttentionService.onComplete → entry.rescoreWithAttention → decide(),
// and decide() runs the HARD SAFETY GATE FIRST and re-applies every conviction
// cap (decisionCaps.ts). So a provider — local Athena, a manual operator board,
// or a remote Manus API — can NEVER override safety, force a BUY, or lower the
// conviction gate. It can only contribute the `attention` facet that decide()
// MAY use to upgrade WATCH→BUY on merit. This file is the seam every Manus-style
// integration plugs into; nothing here can move funds or sign anything.
// ─────────────────────────────────────────────────────────────────────────────

/** What one research pass produced for one coin. */
export interface ResearchResult {
  scores: AttentionScores;
  evidence: AttentionEvidence;
  /** How the read was produced: "heuristic" | "llm" | a provider tag ("manus", …). */
  source: string;
  /** The provider that ran, for provenance / audit ("athena", "manus", "board"). */
  provider: string;
}

/** A backend that can research a coin's attention. */
export interface ResearchProvider {
  /** Stable id used for provenance + the audit trail. */
  readonly name: string;
  /** True only when this provider can run right now (e.g. an endpoint + key are
   *  configured). When false the registry falls through to the next provider, so
   *  the always-available local Athena is the guaranteed floor. */
  available(): boolean;
  research(coin: CoinRef): Promise<ResearchResult>;
}
