import type { Decision, NewToken, SafetyResult } from "../types.js";
import type { RugcheckReport } from "../sources/rugcheck.js";

// Per-token lifecycle. A token moves NEW → (Stage-0) → OBSERVING → SCORED, or
// is AVOIDED at any hard gate. OBSERVING is the Stage-1 window (30–180s) during
// which the momentum/organic engines accumulate trades before a BUY can be made.

export type TokenPhase = "NEW" | "OBSERVING" | "SCORED" | "AVOIDED" | "EXPIRED";

export interface TrackedToken {
  token: NewToken;
  phase: TokenPhase;
  firstSeenAt: number;
  observeUntil?: number;
  stage0?: SafetyResult;
  stage1?: SafetyResult;
  lastDecision?: Decision;
  /** Full RugCheck report (for the risk layer + UI; Phase 1 stashes it). */
  rugcheck?: RugcheckReport;
}

export class TokenStateMachine {
  private readonly map = new Map<string, TrackedToken>();

  track(token: NewToken, now = Date.now()): TrackedToken {
    const t: TrackedToken = { token, phase: "NEW", firstSeenAt: now };
    this.map.set(token.mint, t);
    return t;
  }

  get(mint: string): TrackedToken | undefined {
    return this.map.get(mint);
  }

  has(mint: string): boolean {
    return this.map.has(mint);
  }

  observing(): TrackedToken[] {
    return [...this.map.values()].filter((t) => t.phase === "OBSERVING");
  }

  size(): number {
    return this.map.size;
  }

  forget(mint: string): void {
    this.map.delete(mint);
  }

  /** Drop tokens that finished their lifecycle or aged out, to bound memory. */
  prune(now = Date.now(), maxAgeMs = 60 * 60 * 1000): number {
    let removed = 0;
    for (const [mint, t] of this.map) {
      const stale = now - t.firstSeenAt > maxAgeMs;
      const done = t.phase === "AVOIDED" || t.phase === "EXPIRED";
      if (stale || (done && now - t.firstSeenAt > 5 * 60 * 1000)) {
        this.map.delete(mint);
        removed++;
      }
    }
    return removed;
  }
}
