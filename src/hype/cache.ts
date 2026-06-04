import type { HypeResult } from "../types.js";

// Per-mint hype cache. The narrative of a token doesn't change minute to minute,
// so we cache the (possibly LLM-derived) result and avoid repeat API calls.
export class HypeCache {
  private readonly m = new Map<string, { at: number; res: HypeResult }>();

  constructor(private readonly ttlMs = 30 * 60 * 1000) {}

  get(mint: string, now = Date.now()): HypeResult | undefined {
    const hit = this.m.get(mint);
    if (hit && now - hit.at < this.ttlMs) return hit.res;
    return undefined;
  }

  set(mint: string, res: HypeResult, now = Date.now()): void {
    this.m.set(mint, { at: now, res });
  }
}
