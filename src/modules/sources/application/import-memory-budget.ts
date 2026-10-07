/**
 * Finalize and Apply hold a whole import in memory: measured at the 256 MiB limit, one peaks
 * at 1.7-2.4 GB RSS, and per-user quotas do not stop two users starting one each. This admits
 * them against a shared byte budget (the Markdown each will load), first come first served:
 * small imports run side by side, a large one waits for room. Waiting, not refusing, because
 * a refused finalize makes the browser abandon the upload.
 *
 * ponytail: per process; several server processes each get their own budget.
 */
export class ImportMemoryBudget {
  private used = 0;
  private readonly queue: { bytes: number; admit: () => void }[] = [];

  constructor(private readonly capacity: number) {}

  async run<T>(bytes: number, work: () => Promise<T>): Promise<T> {
    // An import larger than the whole budget still runs, alone.
    const weight = Math.min(Math.max(bytes, 0), this.capacity);
    await this.acquire(weight);
    try {
      return await work();
    } finally {
      this.used -= weight;
      this.admitWaiting();
    }
  }

  private acquire(weight: number): Promise<void> {
    if (this.queue.length === 0 && this.used + weight <= this.capacity) {
      this.used += weight;
      return Promise.resolve();
    }
    return new Promise((admit) => this.queue.push({ bytes: weight, admit }));
  }

  private admitWaiting(): void {
    while (this.queue.length > 0 && this.used + this.queue[0].bytes <= this.capacity) {
      const next = this.queue.shift()!;
      this.used += next.bytes;
      next.admit();
    }
  }
}
