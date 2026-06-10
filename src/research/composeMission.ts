import type { Services } from "../services.js";
import type { Decision, SafetyResult } from "../types.js";
import type { Mission } from "./mission.types.js";
import { generateMission } from "./missionGenerator.js";

// Compose a Mission for a coin from its journalled signal + cached research/intel.
// Shared by the operator mission board (routes.manus.ts) and the automated Manus
// runner so both produce the identical investigation blueprint.

export function composeMissionForMint(svc: Services, mint: string, now: number): Mission | undefined {
  const history = svc.signals.forMint(mint, 100);
  const sig = history.at(-1);
  if (!sig) return undefined;
  const decision: Decision = {
    mint: sig.mint,
    symbol: sig.symbol,
    verdict: sig.verdict,
    conviction: sig.conviction,
    scores: sig.scores,
    reasons: sig.reasons,
    flags: sig.flags,
    caps: sig.caps,
    redFlags: sig.redFlags,
    pairCreatedAt: sig.pairCreatedAt,
    at: sig.at,
  };
  // Safety checks aren't journalled; synthesize the gate result we DO know
  // (pass iff it wasn't an AVOID). Empty checks ⇒ rugcheck/holders buckets read
  // thin — honest: it tells the researcher to verify them itself.
  const safety: SafetyResult = {
    pass: sig.verdict !== "AVOID",
    stage: 1,
    checks: [],
    unknownCount: 0,
    fatalReasons: [],
    score: sig.scores.safety ?? 0,
  };
  return generateMission({
    decision,
    safety,
    attention: svc.attention?.record(mint),
    intel: svc.runtime.intel.get(mint),
    now,
  });
}
