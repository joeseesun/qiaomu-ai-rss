import type { Entry, Subscription } from './model';
const order = (a: Entry, b: Entry) => (b.publishedTs || 0) - (a.publishedTs || 0) || a.id.localeCompare(b.id);
/** Reuse unchanged lists; merge only changed sources into the already sorted timeline. */
export class FeedIndex {
  private feeds = new Map<string, Entry[]>();
  private entries: Entry[] = [];
  update(feeds: Subscription[]): Entry[] {
    const next = new Map(feeds.map(feed => [feed.id, feed.entries]));
    const changed = new Set([...next.keys(), ...this.feeds.keys()].filter(id => next.get(id) !== this.feeds.get(id)));
    if (!changed.size) return this.entries;
    const retained = this.entries.filter(entry => !changed.has(entry.sourceId));
    const added = feeds.filter(feed => changed.has(feed.id)).flatMap(feed => feed.entries).sort(order);
    const result: Entry[] = []; let a = 0, b = 0;
    while (a < retained.length && b < added.length) result.push(order(retained[a], added[b]) <= 0 ? retained[a++] : added[b++]);
    this.entries = result.concat(retained.slice(a), added.slice(b)); this.feeds = next; return this.entries;
  }
}
