import { registerSource, ensureGroup } from './personal-library';
import { requestUrl } from 'obsidian';
import { feedUrl, MAX_SUBSCRIPTIONS, parseFeed, stableId, type FeedInput } from './feeds';
import { subscriptionSchema, type State, type Subscription } from './model';
import { fail, isLocalizedError, LocalizedError, t } from './i18n';
export type FeedTransport = (url: string) => Promise<{ status: number; text: string }>;
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
  private pending = new Map<string, Promise<void>>();
  constructor(private state: () => State, private persist: () => Promise<void>, private transport: FeedTransport = url => requestUrl({ url, method: 'GET', throw: false })) {}
  async fetch(url: string, doc: Document) {
    let timer: number | undefined;
    try {
      const response = await Promise.race([
        this.transport(url),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new LocalizedError(t('error.feedTimeout'))), 20000); }),
      ]);
      if (response.status < 200 || response.status >= 300) fail('error.feedUnavailable', { status: response.status });
      return await parseFeed(response.text, url, doc);
    } catch (error) {
      // Do not include transport errors: private feed URLs can contain access tokens.
      if (isLocalizedError(error)) throw error;
      fail('error.feedUnreadable');
    } finally { window.clearTimeout(timer); }
  }
  async add(raw: string, group: string, doc: Document): Promise<Subscription> {
    const url = feedUrl(raw);
    if (this.state().subscriptions.some(feed => feed.url === url)) fail('error.feedDuplicate');
    if (this.state().subscriptions.length >= MAX_SUBSCRIPTIONS) fail('error.feedLimit', { n: MAX_SUBSCRIPTIONS });
    const parsed = await this.fetch(url, doc);
    const feed = subscriptionSchema.parse({ id: `local:${await stableId(url)}`, url, name: parsed.name, group: group.trim().slice(0, 100), site: parsed.site, image: parsed.image, entries: parsed.entries, updatedAt: Date.now() });
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
      feed.lastAttemptAt = Date.now();
      try {
        const parsed = await this.fetch(feed.url, doc);
        if (!this.state().subscriptions.includes(feed)) return;
        feed.entries = parsed.entries; feed.site = parsed.site || feed.site; feed.image = parsed.image || feed.image; feed.updatedAt = Date.now(); feed.error = '';
      } catch (error) {
        if (!this.state().subscriptions.includes(feed)) return;
        feed.error = error instanceof Error ? error.message : t('error.feedUnreadableShort');
      }
      let bytes = 0;
      for (const item of [...this.state().subscriptions].sort((a, b) => b.updatedAt - a.updatedAt)) {
        bytes += new TextEncoder().encode(JSON.stringify(item.entries)).length;
        if (bytes > 20 * 1024 * 1024) item.entries = [];
      }
      await this.persist();
    };
    const promise = refresh().finally(() => this.pending.delete(id)); this.pending.set(id, promise); return promise;
  }
}
