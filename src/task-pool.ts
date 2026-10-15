/** Bounds real transports, including those that outlive a caller's UI timeout. */
export class TaskPool {
  private active = 0;
  private background = 0;
  private stopped = false;
  private queue: { priority: number; start: () => void; reject: (error: Error) => void }[] = [];
  constructor(private limit: number, private maxQueued = 64) {}
  run<T>(work: () => Promise<T>, current: () => boolean = () => true, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item = { priority, reject, start: () => {
        if (this.stopped || !current()) { reject(new Error('Cancelled')); this.drain(); return; }
        this.active++; if (priority > 0) this.background++;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => { this.active--; if (priority > 0) this.background--; this.drain(); });
      } };
      if (this.stopped || this.queue.length >= this.maxQueued) { reject(new Error('Unavailable')); return; }
      if (this.active < this.limit && (priority === 0 || this.background < Math.max(1, this.limit - 1))) item.start(); else { this.queue.push(item); this.queue.sort((a, b) => a.priority - b.priority); }
    });
  }
  private drain() {
    while (!this.stopped && this.active < this.limit) {
      const index = this.queue.findIndex(item => item.priority === 0 || this.background < Math.max(1, this.limit - 1));
      if (index < 0) return;
      this.queue.splice(index, 1)[0].start();
    }
  }
  dispose() { this.stopped = true; for (const item of this.queue.splice(0)) item.reject(new Error('Cancelled')); }
}
