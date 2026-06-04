import type { Agent, AgentContext, AgentResult } from "./types.js";
import { withTimeout } from "../util/withTimeout.js";
import { metrics } from "../util/metrics.js";

// Runs agents concurrently. Promise.allSettled + an internal try/catch per agent
// means one slow or throwing agent can never break the batch — it becomes an
// `unknown` result with confidence 0 (and is counted as a missing source by the
// source-agreement agent in Phase 4). Per-agent latency → metrics.

export async function runAgents(agents: Agent[], ctx: AgentContext, timeoutMs = 2500): Promise<Map<string, AgentResult>> {
  const settled = await Promise.allSettled(
    agents.map(async (a): Promise<AgentResult> => {
      const start = Date.now();
      try {
        const out = await withTimeout(Promise.resolve(a.run(ctx)), timeoutMs);
        return { id: a.id, latencyMs: Date.now() - start, ...out };
      } catch {
        return {
          id: a.id,
          score: 50,
          confidence: 0,
          unknown: true,
          latencyMs: Date.now() - start,
          reasons: ["agent failed or timed out"],
        };
      }
    }),
  );

  const map = new Map<string, AgentResult>();
  for (const s of settled) {
    // Each thunk catches internally, so settled entries are always fulfilled;
    // guard anyway so the coordinator is bullet-proof.
    if (s.status === "fulfilled") {
      map.set(s.value.id, s.value);
      metrics.observe(`agent_${s.value.id}_ms`, s.value.latencyMs);
    }
  }
  return map;
}

/** Convenience: a result's score if confident, else a neutral fallback. */
export function scoreOf(map: Map<string, AgentResult>, id: string, fallback = 50): number {
  const r = map.get(id);
  return r && !r.unknown ? r.score : fallback;
}
