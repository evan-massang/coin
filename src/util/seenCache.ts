/**
 * Bounded de-dup cache with TTL. Used to avoid re-processing the same mint on
 * reconnect / replay (see Part 9: "restart de-dups via seen-cache").
 */
export class SeenCache {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly max = 50_000,
  ) {}

  /** Returns true if `key` is new (and records it); false if seen within TTL. */
  add(key: string, now = Date.now()): boolean {
    const prev = this.seen.get(key);
    if (prev !== undefined && now - prev < this.ttlMs) return false;
    this.seen.set(key, now);
    if (this.seen.size > this.max) this.evict(now);
    return true;
  }

  has(key: string, now = Date.now()): boolean {
    const prev = this.seen.get(key);
    return prev !== undefined && now - prev < this.ttlMs;
  }

  private evict(now: number): void {
    for (const [k, t] of this.seen) {
      if (now - t >= this.ttlMs) this.seen.delete(k);
    }
    // Still over capacity → drop oldest insertions.
    if (this.seen.size > this.max) {
      const overflow = this.seen.size - this.max;
      let i = 0;
      for (const k of this.seen.keys()) {
        if (i++ >= overflow) break;
        this.seen.delete(k);
      }
    }
  }

  get size(): number {
    return this.seen.size;
  }
}
