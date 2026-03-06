export class CircuitBreaker {
  private failedCycles: number[] = [];
  private readonly maxCycles: number;
  private readonly windowMs: number;
  private tripped = false;

  constructor(maxCycles: number = 3, windowMs: number = 3600000) {
    this.maxCycles = maxCycles;
    this.windowMs = windowMs;
  }

  recordFailedCycle(): boolean {
    const now = Date.now();
    this.failedCycles.push(now);
    this.pruneOldCycles(now);

    if (this.failedCycles.length >= this.maxCycles) {
      this.tripped = true;
    }

    return this.tripped;
  }

  isTripped(): boolean {
    this.pruneOldCycles(Date.now());
    if (this.failedCycles.length < this.maxCycles) {
      this.tripped = false;
    }
    return this.tripped;
  }

  reset(): void {
    this.failedCycles = [];
    this.tripped = false;
  }

  getFailedCycleCount(): number {
    this.pruneOldCycles(Date.now());
    return this.failedCycles.length;
  }

  private pruneOldCycles(now: number): void {
    const cutoff = now - this.windowMs;
    this.failedCycles = this.failedCycles.filter((t) => t > cutoff);
  }
}
