import type { ResearchProvider, ResearchResult } from "./researchProvider.js";
import type { CoinRef } from "../attention/attentionService.js";

// Ordered set of research providers, MOST-PREFERRED FIRST. pick() returns the
// first provider whose available() is true; the last-registered provider MUST be
// an always-available fallback (the local Athena), so research() can never fail
// to produce a read and a misconfigured remote provider silently degrades to
// Athena instead of stalling the engine. Itself a ResearchProvider, so
// AttentionService can consume the registry directly.
export class ProviderRegistry implements ResearchProvider {
  readonly name = "registry";
  private readonly providers: ResearchProvider[] = [];

  /** Register in preference order (call with the most-preferred provider first). */
  register(p: ResearchProvider): this {
    this.providers.push(p);
    return this;
  }

  /** The first provider that can run right now (undefined if none registered). */
  pick(): ResearchProvider | undefined {
    return this.providers.find((p) => p.available());
  }

  available(): boolean {
    return this.providers.some((p) => p.available());
  }

  async research(coin: CoinRef): Promise<ResearchResult> {
    const p = this.pick();
    if (!p) throw new Error("no research provider available");
    return p.research(coin);
  }

  /** Registered provider names in preference order (observability / audit). */
  names(): string[] {
    return this.providers.map((p) => p.name);
  }

  /** Name of the provider that would run right now (for provenance display). */
  activeName(): string | undefined {
    return this.pick()?.name;
  }
}
