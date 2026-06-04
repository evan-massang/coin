/**
 * Tiny in-process metrics: counters + latency samples. Surfaced on the dashboard
 * to confirm e.g. "Stage-0 latency sub-second" (Part 9).
 */
class Metrics {
  private counters = new Map<string, number>();
  private timings = new Map<string, number[]>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  /** Record a latency sample (ms), keeping the last 200 per metric. */
  observe(name: string, ms: number): void {
    const arr = this.timings.get(name) ?? [];
    arr.push(ms);
    if (arr.length > 200) arr.shift();
    this.timings.set(name, arr);
  }

  /** Time a synchronous function, recording its duration under `name`. */
  time<T>(name: string, fn: () => T): T {
    const start = Date.now();
    try {
      return fn();
    } finally {
      this.observe(name, Date.now() - start);
    }
  }

  snapshot(): { counters: Record<string, number>; timings: Record<string, { p50: number; p95: number; n: number }> } {
    const counters = Object.fromEntries(this.counters);
    const timings: Record<string, { p50: number; p95: number; n: number }> = {};
    for (const [k, arr] of this.timings) {
      const sorted = [...arr].sort((a, b) => a - b);
      timings[k] = {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        n: sorted.length,
      };
    }
    return { counters, timings };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export const metrics = new Metrics();
