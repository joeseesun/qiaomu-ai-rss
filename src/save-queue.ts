/** Coalesce a burst into one durable write; changes during a write form the next batch.
 * Each caller settles only after the batch containing its change has reached disk.
 */
export class SaveQueue {
  private pending?: { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };
  private running = false;
  constructor(private write: () => Promise<void>) {}
  request(): Promise<void> {
    if (!this.pending) {
      let resolve!: () => void, reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      this.pending = { promise, resolve, reject };
    }
    const result = this.pending.promise;
    if (!this.running) { this.running = true; queueMicrotask(() => { void this.drain(); }); }
    return result;
  }
  private async drain() {
    while (this.pending) {
      const batch = this.pending; this.pending = undefined;
      try { await this.write(); batch.resolve(); } catch (error) { batch.reject(error); }
    }
    this.running = false;
  }
}
