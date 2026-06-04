/**
 * Token-bucket rate limiter to keep free-tier API usage within bounds (Part 10:
 * detection/observer/exit monitoring use free tiers). `acquire()` resolves when
 * a token is available.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst = ratePerSec,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.lastRefill = now;
  }

  private refill(now: number): void {
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
    this.lastRefill = now;
  }

  /** Try to take a token without waiting. */
  tryAcquire(now = Date.now()): boolean {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Wait until a token is available, then take it. */
  async acquire(): Promise<void> {
    // Loop with short sleeps; fine for the modest rates this app uses.
    for (;;) {
      if (this.tryAcquire()) return;
      const waitMs = Math.max(10, Math.ceil(1000 / this.ratePerSec));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
