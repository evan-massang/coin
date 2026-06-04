// Tiny serial async queue so AI Computer research runs in the background and
// NEVER blocks the scanner. Tasks that throw are swallowed (logged by caller).
export class TaskQueue {
  private readonly q: Array<() => Promise<void>> = [];
  private running = false;

  get size(): number {
    return this.q.length;
  }

  enqueue(fn: () => Promise<void>): void {
    this.q.push(fn);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.q.length > 0) {
      const fn = this.q.shift()!;
      try {
        await fn();
      } catch {
        /* isolated — one failed task never stops the queue */
      }
    }
    this.running = false;
  }
}
