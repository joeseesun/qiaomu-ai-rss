import { requestUrl } from 'obsidian';
import { feedUrl, MAX_SUBSCRIPTIONS, parseFeed, stableId, type FeedInput } from './feeds';
import { subscriptionSchema, type State, type Subscription } from './model';
export type FeedTransport = (url: string) => Promise<{ status: number; text: string }>;
export class Subscriptions {
  private pending = new Map<string, Promise<void>>();
  constructor(private state: () => State, private persist: () => Promise<void>, private transport: FeedTransport = url => requestUrl({ url, method: 'GET', throw: false })) {}
  private async fetch(url: string, doc: Document) {
    let timer: number | undefined;
    try {
      const response = await Promise.race([
        this.transport(url),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('订阅源响应超时，请重试。')), 20000); }),
      ]);
      if (response.status < 200 || response.status >= 300) throw new Error(`订阅源暂不可用（HTTP ${response.status}）。`);
      return await parseFeed(response.text, url, doc);
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
    const feed = subscriptionSchema.parse({ id: `local:${await stableId(url)}`, url, name: parsed.name, group: group.trim().slice(0, 100), entries: parsed.entries, updatedAt: Date.now() });
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
  async refresh(ids: string[], doc: Document, force = false, updated?: () => void): Promise<void> {
    const remaining = [...ids];
    const worker = async () => { while (remaining.length) { const id = remaining.shift(); if (id) { await this.refreshOne(id, doc, force); updated?.(); } } };
    await Promise.all(Array.from({ length: Math.min(3, remaining.length) }, worker));
  }
  private refreshOne(id: string, doc: Document, force: boolean): Promise<void> {
    const ongoing = this.pending.get(id); if (ongoing) return ongoing;
    const feed = this.state().subscriptions.find(item => item.id === id);
    if (!feed || (!force && Date.now() - feed.updatedAt < 300000)) return Promise.resolve();
    const refresh = async () => {
      try {
        const parsed = await this.fetch(feed.url, doc);
        if (!this.state().subscriptions.includes(feed)) return;
        feed.entries = parsed.entries; feed.updatedAt = Date.now(); feed.error = '';
      } catch (error) {
        if (!this.state().subscriptions.includes(feed)) return;
        feed.error = error instanceof Error ? error.message : '订阅源无法读取。';
      }
      await this.persist();
    };
    const promise = refresh().finally(() => this.pending.delete(id)); this.pending.set(id, promise); return promise;
  }
}
