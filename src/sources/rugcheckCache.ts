import { fetchRugcheck, type RugcheckReport } from "./rugcheck.js";
import { RateLimiter } from "../util/rateLimiter.js";
import { metrics } from "../util/metrics.js";

// Per-mint TTL cache + in-flight de-dup + rate limit around RugCheck. Keeps the
// keyless free tier happy: a mint is fetched at most once per TTL, and
// concurrent callers (Stage-0, re-score, on-demand checker) share one request.
export class RugcheckCache {
  private readonly cache = new Map<string, { report: RugcheckReport; at: number }>();
  private readonly inflight = new Map<string, Promise<RugcheckReport | undefined>>();
  private readonly limiter: RateLimiter;

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    ratePerSec = 2,
  ) {
    this.limiter = new RateLimiter(ratePerSec);
  }

  async getReport(mint: string, opts: { apiKey?: string; force?: boolean } = {}): Promise<RugcheckReport | undefined> {
    const now = Date.now();
    if (!opts.force) {
      const hit = this.cache.get(mint);
      if (hit && now - hit.at < this.ttlMs) return hit.report;
    }
    const existing = this.inflight.get(mint);
    if (existing) return existing;

    const p = (async () => {
      await this.limiter.acquire();
      const t0 = Date.now();
      const report = await fetchRugcheck(mint, opts.apiKey);
      metrics.observe("rugcheck_ms", Date.now() - t0);
      if (report) this.cache.set(mint, { report, at: Date.now() });
      return report;
    })().finally(() => this.inflight.delete(mint));

    this.inflight.set(mint, p);
    return p;
  }
}
