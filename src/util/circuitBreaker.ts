// Circuit breaker: after `failThreshold` failures within `windowMs`, the circuit
// opens for `cooldownMs` — `run()` throws immediately so the caller falls back
// to another source instead of hammering a degraded API.
export class CircuitBreaker {
  private failures: number[] = [];
  private openUntil = 0;

  constructor(
    private readonly failThreshold = 5,
    private readonly windowMs = 60_000,
    private readonly cooldownMs = 120_000,
  ) {}

  isOpen(now = Date.now()): boolean {
    return now < this.openUntil;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) throw new Error("circuit open");
    try {
      const r = await fn();
      this.failures = [];
      return r;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  private recordFailure(now = Date.now()): void {
    this.failures.push(now);
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    if (this.failures.length >= this.failThreshold) {
      this.openUntil = now + this.cooldownMs;
      this.failures = [];
    }
  }
}
