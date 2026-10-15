import { TaskPool } from './task-pool';
import { registerSource, ensureGroup } from './personal-library';
import { requestUrl } from 'obsidian';
import { feedUrl, MAX_SUBSCRIPTIONS, parseFeed, stableId, type FeedInput } from './feeds';
import { stripFeedBodies, subscriptionSchema, type State, type Subscription } from './model';
import { fail, isLocalizedError, LocalizedError, t } from './i18n';
export type FeedTransport = (url: string, headers?: Record<string, string>) => Promise<{ status: number; text: string; headers?: Record<string, string> }>;
export type RefreshOutcome = 'changed' | 'unchanged' | 'failed' | 'skipped';
export interface RefreshSummary { refreshed: number; changed: number; unchanged: number; failed: number; skipped: number; elapsedMs: number; bodiesChanged: boolean }
/** Failing feeds retry on an exponential backoff: 5m → 10m → 20m → 40m → 1h cap. */
export function refreshBackoffMs(errorCount: number): number {
  return Math.min(3600000, 300000 * 2 ** Math.max(0, errorCount - 1));
}
/** Frequent feeds keep the 5-minute floor; slower sources avoid needless polling. */
export function refreshIntervalMs(feed: Subscription): number {
  const times = feed.entries.map(entry => entry.publishedTs).filter((value): value is number => typeof value === 'number').slice(0, 10).sort((a, b) => b - a);
  const gaps = times.slice(1).map((value, i) => times[i] - value).filter(value => value > 0).sort((a, b) => a - b);
  return gaps.length ? Math.max(300000, Math.min(3600000, gaps[Math.floor(gaps.length / 2)] / 4)) : 300000;
}
function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === want) return value || undefined;
  return undefined;
}
interface FetchResult { name: string; entries: Subscription['entries']; site?: string; image?: string; notModified: boolean; etag?: string; lastModified?: string }
export class Subscriptions {
  private mutations: Promise<unknown> = Promise.resolve();
  private commit<T>(edit: () => T): Promise<T> {
    const run = this.mutations.catch(() => undefined).then(async () => {
      const state = this.state(), previous = structuredClone({ subscriptions: state.subscriptions, sourceMeta: state.sourceMeta, subscriptionGroups: state.subscriptionGroups, collapsedGroups: state.collapsedGroups, cache: state.cache });
      try { const result = edit(); await this.persist(); return result; }
      catch (error) { Object.assign(state, previous); throw error; }
    });
    this.mutations = run; return run;
  }
  private pool = new TaskPool(3);
  private disposed = false;
  dispose() { this.disposed = true; this.pool.dispose(); }
  private pending = new Map<string, Promise<{ outcome: RefreshOutcome; bodies: boolean }>>();
  constructor(private state: () => State, private persist: () => Promise<void>, private transport: FeedTransport = async (url, headers) => {
    const response = await requestUrl({ url, method: 'GET', headers, throw: false });
    return { status: response.status, text: response.text, headers: response.headers };
  }, private onBodiesChanged: () => void = () => undefined) {}
  /** One-shot feed fetch (also used by the discovery preview); cached transports live in refreshOne. */
  async fetch(url: string, doc: Document, conditional?: { etag?: string; lastModified?: string }, background = false, current: () => boolean = () => true): Promise<FetchResult> {
    let timer: number | undefined;
    let waiting = true;
    try {
      const headers: Record<string, string> = {};
      if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
      if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;
      const response = await Promise.race([
        this.pool.run(() => this.transport(url, Object.keys(headers).length ? headers : undefined), () => waiting && !this.disposed && current(), background ? 1 : 0),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new LocalizedError(t('error.feedTimeout'))), 20000); }),
      ]);
      // A 304 means the feed is unchanged: skip the download body, parsing and entry rebuild entirely.
      if (response.status === 304) return { name: '', entries: [], notModified: true, etag: conditional?.etag, lastModified: conditional?.lastModified };
      if (response.status < 200 || response.status >= 300) fail('error.feedUnavailable', { status: response.status });
      const parsed = await parseFeed(response.text, url, doc);
      return { ...parsed, notModified: false, etag: headerValue(response.headers, 'etag'), lastModified: headerValue(response.headers, 'last-modified') };
    } catch (error) {
      // Do not include transport errors: private feed URLs can contain access tokens.
      if (isLocalizedError(error)) throw error;
      fail('error.feedUnreadable');
    } finally { waiting = false; window.clearTimeout(timer); }
  }
  async add(raw: string, group: string, doc: Document): Promise<Subscription> {
    const url = feedUrl(raw);
    if (this.state().subscriptions.some(feed => feed.url === url)) fail('error.feedDuplicate');
    if (this.state().subscriptions.length >= MAX_SUBSCRIPTIONS) fail('error.feedLimit', { n: MAX_SUBSCRIPTIONS });
    const parsed = await this.fetch(url, doc);
    const feed = subscriptionSchema.parse({ id: `local:${await stableId(url)}`, url, name: parsed.name, group: group.trim().slice(0, 100), site: parsed.site, image: parsed.image, entries: parsed.entries, updatedAt: Date.now(), etag: parsed.etag, lastModified: parsed.lastModified });
    return this.commit(() => {
      if (this.state().subscriptions.some(item => item.url === url)) fail('error.feedDuplicate');
      if (this.state().subscriptions.length >= MAX_SUBSCRIPTIONS) fail('error.feedLimit', { n: MAX_SUBSCRIPTIONS });
      this.state().subscriptions.push(feed); registerSource(this.state(), feed.id, feed.group); return feed;
    });
  }

  async import(feeds: FeedInput[]): Promise<number> {
    const prepared = await Promise.all(feeds.map(async input => {
      const url = feedUrl(input.url);
      return subscriptionSchema.parse({ ...input, url, id: `local:${await stableId(url)}` });
    }));
    return this.commit(() => {
      const existing = new Set(this.state().subscriptions.map(feed => feed.url));
      const additions = prepared.filter(feed => { if (existing.has(feed.url)) return false; existing.add(feed.url); return true; });
      if (this.state().subscriptions.length + additions.length > MAX_SUBSCRIPTIONS) fail('error.importLimit', { n: MAX_SUBSCRIPTIONS });
      this.state().subscriptions.push(...additions); for (const feed of additions) registerSource(this.state(), feed.id, feed.group);
      if (additions.length > 60) {
        const state = this.state();
        state.collapsedGroups = [...new Set([...state.collapsedGroups, ...additions.map(feed => state.sourceMeta[feed.id].groupId).filter(Boolean)])];
      }
      return additions.length;
    });
  }
  async edit(id: string, name: string, group: string) {
    await this.commit(() => {
      const feed = this.state().subscriptions.find(item => item.id === id); if (!feed) return;
      if (!name.trim()) fail('error.feedNameEmpty');
      feed.name = name.trim().slice(0, 200); feed.group = group.trim().slice(0, 100); registerSource(this.state(), id, feed.group); this.state().sourceMeta[id].groupId = ensureGroup(this.state(), feed.group);
    });
  }
  async remove(id: string) {
    await this.commit(() => {
      const state = this.state(); delete state.sourceMeta[id]; state.subscriptions = state.subscriptions.filter(feed => feed.id !== id);
      for (const [key, bundle] of Object.entries(state.cache)) if (bundle.entry.sourceId === id) delete state.cache[key];
    });
  }
  async setPaused(id: string, paused: boolean): Promise<void> {
    const feed = this.state().subscriptions.find(item => item.id === id); if (!feed || feed.paused === paused) return;
    await this.commit(() => { feed.paused = paused; });
  }

  /** Syncs the given feeds with three workers, one persist at the end, and a per-feed summary. */
  async refresh(ids: string[], doc: Document, force = false, updated?: (done: number, total: number, outcome: RefreshOutcome) => void, current: () => boolean = () => true): Promise<RefreshSummary> {
    const started = Date.now();
    // Stale-first with failed feeds last, so fresh content paints early during a long sync.
    const feeds = new Map(this.state().subscriptions.map(feed => [feed.id, feed]));
    const remaining = [...new Set(ids)].filter(id => feeds.has(id)).sort((a, b) => {
      const fa = feeds.get(a)!, fb = feeds.get(b)!;
      return ((fa.errorCount > 0 ? 1 : 0) - (fb.errorCount > 0 ? 1 : 0)) || fa.updatedAt - fb.updatedAt;
    });
    const total = remaining.length;
    let done = 0, changed = 0, unchanged = 0, failed = 0, skipped = 0, bodiesChanged = false;
    const worker = async () => {
      while (remaining.length && current() && !this.disposed) {
        const id = remaining.shift(); if (!id) continue;
        const result = await this.refreshOne(id, doc, force, current);
        done++;
        if (done % 20 === 0) await new Promise<void>(resolve => doc.defaultView!.setTimeout(resolve, 0));
        if (result.outcome === 'changed') changed++;
        else if (result.outcome === 'unchanged') unchanged++;
        else if (result.outcome === 'failed') failed++;
        else skipped++;
        if (result.bodies) bodiesChanged = true;
        if (current() && !this.disposed) updated?.(done, total, result.outcome);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, remaining.length) }, worker));
    // Cap total stored feed bytes once per sync instead of once per feed.
    if (changed > 0) {
      let bytes = 0;
      for (const item of [...this.state().subscriptions].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const size = item.entries.reduce((sum, entry) => sum + (entry.content ? new TextEncoder().encode(entry.content).length : 0), 0);
        if (bytes + size > 20 * 1024 * 1024) { item.entries = stripFeedBodies(item.entries).entries; bodiesChanged = true; }
        else bytes += size;
      }
    }
    if (bodiesChanged) this.onBodiesChanged();
    if (!this.disposed && changed + unchanged + failed > 0) await this.persist();
    const summary: RefreshSummary = { refreshed: done, changed, unchanged, failed, skipped, elapsedMs: Date.now() - started, bodiesChanged };
    console.debug(`[qiaomu-ai-rss] sync: ${done} feeds, ${changed} changed, ${unchanged} unchanged, ${failed} failed, ${skipped} skipped, ${summary.elapsedMs}ms`);
    return summary;
  }
  private refreshOne(id: string, doc: Document, force: boolean, current: () => boolean): Promise<{ outcome: RefreshOutcome; bodies: boolean }> {
    const ongoing = this.pending.get(id); if (ongoing) return ongoing;
    const feed = this.state().subscriptions.find(item => item.id === id);
    const skip = { outcome: 'skipped' as const, bodies: false };
    if (!feed) return Promise.resolve(skip);
    if (feed.paused && !force) return Promise.resolve(skip);
    if (!force && Date.now() - feed.updatedAt < refreshIntervalMs(feed)) return Promise.resolve(skip);
    if (!force && feed.errorCount > 0 && Date.now() - feed.lastErrorAt < refreshBackoffMs(feed.errorCount) * (1 + (parseInt(feed.id.slice(-2), 16) || 0) / 1024)) return Promise.resolve(skip);
    const refresh = async (): Promise<{ outcome: RefreshOutcome; bodies: boolean }> => {
      feed.lastAttemptAt = Date.now();
      try {
        const useConditional = (!!feed.etag || !!feed.lastModified);
        const result = await this.fetch(feed.url, doc, useConditional ? { etag: feed.etag, lastModified: feed.lastModified } : undefined, !force, current);
        if (this.disposed || !this.state().subscriptions.includes(feed)) return skip;
        if (result.notModified) {
          feed.updatedAt = Date.now(); feed.errorCount = 0; feed.lastErrorAt = 0;
          if (feed.error) { feed.error = ''; return { outcome: 'changed', bodies: false }; }
          return { outcome: 'unchanged', bodies: false };
        }
        feed.entries = result.entries; feed.site = result.site || feed.site; feed.image = result.image || feed.image;
        feed.updatedAt = Date.now(); feed.error = ''; feed.errorCount = 0; feed.lastErrorAt = 0;
        feed.etag = result.etag; feed.lastModified = result.lastModified;
        return { outcome: 'changed', bodies: true };
      } catch (error) {
        if (!current()) return skip;
        if (this.disposed || !this.state().subscriptions.includes(feed)) return skip;
        feed.error = error instanceof Error ? error.message : t('error.feedUnreadableShort');
        feed.errorCount += 1; feed.lastErrorAt = Date.now();
        return { outcome: 'failed', bodies: false };
      }
    };
    const promise = refresh().finally(() => this.pending.delete(id)); this.pending.set(id, promise); return promise;
  }
}
