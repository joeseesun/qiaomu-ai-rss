import { requestUrl } from 'obsidian';
import { feedUrl, MAX_SUBSCRIPTIONS, parseFeed, stableId, type FeedInput } from './feeds';
import { subscriptionSchema, type State, type Subscription } from './model';
export type FeedTransport = (url: string, headers?: Record<string, string>) => Promise<{ status: number; text: string; headers?: Record<string, string> }>;
export interface RefreshSummary { refreshed: number; changed: number; unchanged: number; failed: number; skipped: number; elapsedMs: number; bodiesChanged: boolean }
export type RefreshOutcome = 'changed' | 'unchanged' | 'failed' | 'skipped';
function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === want) return value || undefined;
  return undefined;
}
export function refreshBackoffMs(errorCount: number): number {
  return Math.min(3600000, 300000 * 2 ** Math.max(0, errorCount - 1));
}
export class Subscriptions {
  private pending = new Map<string, Promise<{ outcome: RefreshOutcome; bodies: boolean }>>();
  constructor(private state: () => State, private persist: () => Promise<void>, private transport: FeedTransport = async (url, headers) => {
    const response = await requestUrl({ url, method: 'GET', headers, throw: false });
    return { status: response.status, text: response.text, headers: response.headers };
  }, private onBodiesChanged: () => void = () => undefined) {}
  private async fetch(url: string, doc: Document, conditional?: { etag?: string; lastModified?: string }) {
    let timer: number | undefined;
    try {
      const headers: Record<string, string> = {};
      if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
      if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;
      const response = await Promise.race([
        this.transport(url, Object.keys(headers).length ? headers : undefined),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('订阅源响应超时，请重试。')), 20000); }),
      ]);
      if (response.status === 304) return { name: '', entries: [], notModified: true as const, etag: conditional?.etag, lastModified: conditional?.lastModified };
      if (response.status < 200 || response.status >= 300) throw new Error(`订阅源暂不可用（HTTP ${response.status}）。`);
      const parsed = await parseFeed(response.text, url, doc);
      return { ...parsed, notModified: false as const, etag: headerValue(response.headers, 'etag'), lastModified: headerValue(response.headers, 'last-modified') };
    } catch (error) {
      // Do not include transport errors: private feed URLs can contain access tokens.
      if (error instanceof Error && /^(订阅源|文件超过|不支持包含|XML 格式|这个地址)/.test(error.message)) throw error;
      throw new Error('无法读取订阅源，请检查地址和网络。');
    } finally { window.clearTimeout(timer); }
  }
  async add(raw: string, group: string, doc: Document): Promise<Subscription> {
    const url = feedUrl(raw);
    if (this.state().subscriptions.some(feed => feed.url === url)) throw new Error('这个订阅源已经添加。');
    if (this.state().subscriptions.length >= MAX_SUBSCRIPTIONS) throw new Error(`最多添加 ${MAX_SUBSCRIPTIONS} 个订阅源。`);
    const parsed = await this.fetch(url, doc);
    const feed = subscriptionSchema.parse({ id: `local:${await stableId(url)}`, url, name: parsed.name, group: group.trim().slice(0, 100), entries: parsed.entries, updatedAt: Date.now(), etag: parsed.etag, lastModified: parsed.lastModified });
    // Recheck after the network request, including concurrently submitted duplicate URLs.
    if (this.state().subscriptions.some(item => item.url === url)) throw new Error('这个订阅源已经添加。');
    if (this.state().subscriptions.length >= MAX_SUBSCRIPTIONS) throw new Error(`最多添加 ${MAX_SUBSCRIPTIONS} 个订阅源。`);
    this.state().subscriptions.push(feed); await this.persist(); return feed;
  }
  async import(feeds: FeedInput[]): Promise<number> {
    const prepared = await Promise.all(feeds.map(async input => {
      const url = feedUrl(input.url);
      return subscriptionSchema.parse({ ...input, url, id: `local:${await stableId(url)}` });
    }));
    const existing = new Set(this.state().subscriptions.map(feed => feed.url));
    const additions = prepared.filter(feed => { if (existing.has(feed.url)) return false; existing.add(feed.url); return true; });
    if (this.state().subscriptions.length + additions.length > MAX_SUBSCRIPTIONS) throw new Error(`导入后超过 ${MAX_SUBSCRIPTIONS} 个订阅源，请减少导入数量。`);
    this.state().subscriptions.push(...additions); await this.persist(); return additions.length;
  }
  async edit(id: string, name: string, group: string) {
    const feed = this.state().subscriptions.find(item => item.id === id); if (!feed) return;
    if (!name.trim()) throw new Error('订阅名称不能为空。');
    feed.name = name.trim().slice(0, 200); feed.group = group.trim().slice(0, 100); await this.persist();
  }
  async remove(id: string) {
    const state = this.state(); state.subscriptions = state.subscriptions.filter(feed => feed.id !== id);
    for (const [key, bundle] of Object.entries(state.cache)) if (bundle.entry.sourceId === id) delete state.cache[key];
    // Favorites are independent snapshots, and links already added to Daily Notes are never removed.
    await this.persist();
  }
  async setPaused(id: string, paused: boolean): Promise<void> {
    const feed = this.state().subscriptions.find(item => item.id === id); if (!feed) return;
    if (feed.paused !== paused) { feed.paused = paused; await this.persist(); }
  }
  async refresh(ids: string[], doc: Document, force = false, updated?: (done: number, total: number) => void): Promise<RefreshSummary> {
    const started = Date.now();
    // Stale-first: oldest update first, previously-failed last, so fresh content paints early.
    const feeds = new Map(this.state().subscriptions.map(feed => [feed.id, feed]));
    const remaining = ids.filter(id => feeds.has(id)).sort((a, b) => {
      const fa = feeds.get(a)!, fb = feeds.get(b)!;
      return ((fa.errorCount > 0 ? 1 : 0) - (fb.errorCount > 0 ? 1 : 0)) || fa.updatedAt - fb.updatedAt;
    });
    const total = remaining.length;
    let done = 0, changed = 0, unchanged = 0, failed = 0, skipped = 0, bodiesChanged = false;
    const worker = async () => {
      while (remaining.length) {
        const id = remaining.shift(); if (!id) continue;
        const result = await this.refreshOne(id, doc, force);
        done++;
        if (result.outcome === 'changed') changed++;
        else if (result.outcome === 'unchanged') unchanged++;
        else if (result.outcome === 'failed') failed++;
        else skipped++;
        if (result.bodies) bodiesChanged = true;
        updated?.(done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, remaining.length) }, worker));
    const summary = { refreshed: done, changed, unchanged, failed, skipped, elapsedMs: Date.now() - started };
    if (bodiesChanged) this.onBodiesChanged();
    if (changed > 0 || failed > 0) await this.persist();
    console.debug(`[qiaomu-ai-rss] sync: ${done} feeds, ${changed} changed, ${unchanged} unchanged, ${failed} failed, ${skipped} skipped, ${summary.elapsedMs}ms`);
    return { ...summary, bodiesChanged };
  }
  private refreshOne(id: string, doc: Document, force: boolean): Promise<{ outcome: RefreshOutcome; bodies: boolean }> {
    const ongoing = this.pending.get(id); if (ongoing) return ongoing;
    const feed = this.state().subscriptions.find(item => item.id === id);
    const skip = { outcome: 'skipped' as const, bodies: false };
    if (!feed) return Promise.resolve(skip);
    if (feed.paused && !force) return Promise.resolve(skip);
    if (!force && Date.now() - feed.updatedAt < 300000) return Promise.resolve(skip);
    if (!force && feed.errorCount > 0 && Date.now() - feed.lastErrorAt < refreshBackoffMs(feed.errorCount)) return Promise.resolve(skip);
    const refresh = async (): Promise<{ outcome: RefreshOutcome; bodies: boolean }> => {
      try {
        const useConditional = !force && (!!feed.etag || !!feed.lastModified);
        const result = await this.fetch(feed.url, doc, useConditional ? { etag: feed.etag ?? undefined, lastModified: feed.lastModified ?? undefined } : undefined);
        if (!this.state().subscriptions.includes(feed)) return skip;
        if (result.notModified) {
          feed.updatedAt = Date.now();
          if (feed.error) { feed.error = ''; return { outcome: 'changed', bodies: false }; }
          return { outcome: 'unchanged', bodies: false };
        }
        feed.entries = result.entries; feed.updatedAt = Date.now(); feed.error = '';
        feed.errorCount = 0; feed.lastErrorAt = 0;
        if (result.etag) feed.etag = result.etag;
        if (result.lastModified) feed.lastModified = result.lastModified;
        return { outcome: 'changed', bodies: true };
      } catch (error) {
        if (!this.state().subscriptions.includes(feed)) return skip;
        feed.error = error instanceof Error ? error.message : '订阅源无法读取。';
        feed.errorCount += 1; feed.lastErrorAt = Date.now();
        return { outcome: 'failed', bodies: false };
      }
    };
    const promise = refresh().finally(() => this.pending.delete(id)); this.pending.set(id, promise); return promise;
  }
}
