// Project Hermes — the Mission: a structured investigation blueprint composed
// from the evidence the engine ALREADY collected, handed to a research provider
// (local Athena, the manual operator board, or a remote Manus API). It pre-fills
// what is known per evidence bucket and flags the THIN ones, so a deeper pass
// targets the gaps instead of starting from scratch. A Mission carries no
// authority: the provider's answer comes back as the attention facet and is
// re-scored through the safety gate.

export type MissionBucketKey =
  | "rugcheck"
  | "holders"
  | "liquidity"
  | "chart"
  | "social"
  | "narrative"
  | "attention"
  | "influencer"
  | "bearCase";

export interface MissionBucket {
  key: MissionBucketKey;
  /** What the engine already established for this bucket (so it isn't re-derived). */
  known: string[];
  /** 0..1 — how well-covered this bucket is right now. */
  coverage: number;
  /** True when coverage is thin enough that a deeper pass should target it. */
  thin: boolean;
}

export interface Mission {
  mint: string;
  symbol?: string;
  name?: string;
  /** The verdict uncertainty this mission exists to resolve. */
  objective: string;
  verdict: string;
  conviction: number;
  buckets: MissionBucket[];
  /** Keys of the thin buckets — the gaps a deeper research pass should close. */
  gaps: MissionBucketKey[];
  /** The strict response shape we want back (parseable, advisory). */
  outputContract: string;
  /** The EXACT prompt text dispatched to the provider (Phase 8: nothing hidden).
   *  Set at dispatch time for discovery/deepdive whose prompts embed live seeds;
   *  per-coin research prompts are deterministic re-renders so may omit it. */
  renderedPrompt?: string;
  createdAt: number;
}
