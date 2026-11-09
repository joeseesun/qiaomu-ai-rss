/** Coalesce a burst into one durable write; changes during a write form the next batch.
 * Each caller settles only after the batch containing its change has reached disk.
 */
export class SaveQueue {
  private pending?: { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void; rollbacks: Array<() => void> };
  private running = false;
  constructor(private write: () => Promise<void>) {}
  request(rollback?: () => void): Promise<void> {
    if (!this.pending) {
      let resolve!: () => void, reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      this.pending = { promise, resolve, reject, rollbacks: [] };
    }
    if (rollback) this.pending.rollbacks.push(rollback);
    const result = this.pending.promise;
    if (!this.running) { this.running = true; queueMicrotask(() => { void this.drain(); }); }
    return result;
  }
  private async drain() {
    while (this.pending) {
      const batch = this.pending; this.pending = undefined;
      try { await this.write(); batch.resolve(); } catch (error) {
        // Roll back before the next write snapshots shared state, not after the caller resumes.
        const errors: unknown[] = [error];
        for (const rollback of batch.rollbacks.reverse()) {
          try { rollback(); } catch (failure) { errors.push(failure); }
        }
        batch.reject(errors.length === 1 ? error : new AggregateError(errors, 'Save and rollback failed'));
      }
    }
    this.running = false;
  }
}
