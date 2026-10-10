import { t } from './i18n';
import type { HttpResponse } from './api';

/** One service client shares admission and retry limits across all panes. */
export class ReadBudget {
  private active = 0;
  private closed = false;
  dispose() {
    this.closed = true;
    for (const item of this.queue) { window.clearTimeout(item.timer); item.reject(this.unavailable()); }
    this.queue = [];
  }
  private background = 0;
  private cooldown = 0;
  private failures = 0;
  private retries: number[] = [];
  private queue: { priority: number; start: () => void; expires: number; reject: (e: Error) => void; timer: number }[] = [];
  private unavailable() { return new Error(t('error.serviceUnavailable', { status: 503 })); }
  allowRetry() {
    const now = Date.now();
    this.retries = this.retries.filter(time => time > now - 30_000);
    if (this.closed || now < this.cooldown || this.retries.length >= 2) return false;
    this.retries.push(now); return true;
  }
  observe(response?: HttpResponse) {
    if (response && response.status < 500 && response.status !== 429 && response.status !== 408) { this.failures = 0; return; }
    this.failures++;
    if (response?.status === 429 || response?.status === 503 || this.failures >= 3) {
      const header = Object.entries(response?.headers || {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
      const delay = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 0;
      this.cooldown = Math.max(this.cooldown, Date.now() + Math.max(10_000, Number.isFinite(delay) ? delay : 0));
    }
  }
  run(priority: number, expires: number, work: () => Promise<HttpResponse>): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      const item = { priority, expires, reject, timer: 0, start: () => {
        window.clearTimeout(item.timer);
        if (this.closed || Date.now() >= expires || Date.now() < this.cooldown) { reject(this.unavailable()); return; }
        this.active++; if (priority > 1) this.background++;
        const finish = () => { this.active--; if (priority > 1) this.background--; this.drain(); };
        // Retain the slot until the actual transport settles, even after the UI timeout.
        try { void work().then(value => { this.observe(value); resolve(value); finish(); }, error => { this.observe(); reject(error instanceof Error ? error : this.unavailable()); finish(); }); }
        catch (error) { this.observe(); reject(error instanceof Error ? error : this.unavailable()); finish(); }
      } };
      if (this.closed || Date.now() < this.cooldown || this.queue.length >= 64) { reject(this.unavailable()); return; }
      if (this.active < 4 && (priority < 2 || this.background < 2)) { item.start(); return; }
      item.timer = window.setTimeout(() => { this.queue = this.queue.filter(value => value !== item); reject(this.unavailable()); }, Math.max(0, expires - Date.now()));
      this.queue.push(item); this.queue.sort((a, b) => a.priority - b.priority);
    });
  }
  private drain() {
    while (this.active < 4) {
      const index = this.queue.findIndex(item => item.priority < 2 || this.background < 2);
      if (index < 0) return;
      this.queue.splice(index, 1)[0].start();
    }
  }
}
