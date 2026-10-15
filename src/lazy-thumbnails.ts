/** Intersection controls the actual loader, not just the final blob <img>. */
export class LazyThumbnails {
  private observer: IntersectionObserver;
  private jobs = new Map<Element, () => Promise<void>>();
  private visible = new Set<Element>();
  private active = 0;
  private stopped = false;
  constructor(root: HTMLElement) {
    const Observer = root.ownerDocument.defaultView!.IntersectionObserver;
    this.observer = new Observer(items => {
      for (const item of items) { if (item.isIntersecting) this.visible.add(item.target); else this.visible.delete(item.target); }
      this.drain();
    }, { root, rootMargin: '200px' });
  }
  observe(target: Element, load: () => Promise<void>) { this.jobs.set(target, load); this.observer.observe(target); }
  prune() {
    for (const target of this.jobs.keys()) if (!target.isConnected) { this.jobs.delete(target); this.visible.delete(target); this.observer.unobserve(target); }
  }
  private drain() {
    if (this.stopped) return;
    this.prune();
    for (const target of this.visible) {
      if (this.active >= 2) break;
      const load = this.jobs.get(target); this.visible.delete(target);
      if (!load) continue;
      this.jobs.delete(target); this.observer.unobserve(target); this.active++;
      void load().catch(() => undefined).finally(() => { this.active--; this.drain(); });
    }
  }
  dispose() { this.stopped = true; this.observer.disconnect(); this.jobs.clear(); this.visible.clear(); }
}
