import type { NewToken, TradeEvent, HypeResult } from "../types.js";
import type { RugcheckReport } from "../sources/rugcheck.js";

// Multi-agent contract (§Phase 3). Each agent independently scores one facet of
// a token. The coordinator runs them concurrently with a per-agent timeout and
// NEVER throws — a slow/failed agent degrades to { unknown:true, confidence:0 }.

export interface AgentResult {
  id: string;
  /** 0..100 facet score (neutral 50 when unknown). */
  score: number;
  /** 0..1 — how much to trust this result (0 when failed/timed-out). */
  confidence: number;
  latencyMs: number;
  fatal?: boolean;
  unknown?: boolean;
  reasons: string[];
  data?: unknown;
}

/** Everything an agent might read. Agents take only what they need. */
export interface AgentContext {
  token: NewToken;
  trades: TradeEvent[];
  now: number;
  firstSeenAt: number;
  marketCapsSol: number[];
  rugcheck?: RugcheckReport;
  devSold?: boolean;
  smartWallets: Map<string, number>;
  /** Min trades required before organic/momentum carry confidence (sufficiency gate). */
  minBuys: number;
  hype: (t: { mint: string; name?: string; symbol?: string }) => Promise<HypeResult>;
}

export type AgentOutput = Omit<AgentResult, "id" | "latencyMs">;

export interface Agent {
  id: string;
  run(ctx: AgentContext): Promise<AgentOutput> | AgentOutput;
}
