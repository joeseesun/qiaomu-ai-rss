// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';

afterEach(() => vi.useRealTimers());
const reply = (value: unknown) => ({ status: 200, text: JSON.stringify(value) });
const entry = { id: 'article', sourceId: 'user-submitted', title: 'Article', content: '<p>Original</p>' };

describe('shared read requests', () => {
  it('serves 100 concurrent article opens with three requests and independent bundles', async () => {
    const transport = vi.fn(async (url: string) => {
      await Promise.resolve();
      return reply(url.endsWith('/rewrite') ? { rewrite: { body: 'Rewrite' } } : url.endsWith('/translation') ? { translation: null } : { entry });
    });
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    const results = await Promise.all(Array.from({ length: 100 }, () => api.article(entry.id)));
    expect(transport).toHaveBeenCalledTimes(3);
    expect(results.every(result => result.bundle.rewrite?.body === 'Rewrite')).toBe(true);
    results[0].bundle.entry.title = 'Changed locally';
    expect(results[1].bundle.entry.title).toBe('Article');
    await api.article(entry.id);
    expect(transport).toHaveBeenCalledTimes(6); // Content stays fresh after the shared request finishes.
  });

  it('releases failed and timed-out requests so the next attempt can recover', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const transport = vi.fn(async () => {
      if (++attempt <= 2) return new Promise<never>(() => {});
      return reply({ entries: [entry] });
    });
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    const outcomes = Promise.allSettled([api.entries(), api.entries()]);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await outcomes).every(result => result.status === 'rejected')).toBe(true);
    expect((await api.entries()).entries).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps query paths and service origins isolated', async () => {
    const transport = vi.fn(async () => reply({ entries: [entry] }));
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    const other = new RssApi('https://example.com', transport);
    await Promise.all([api.entries('a'), api.entries('b'), api.entries('a', 'next'), other.entries('a')]);
    expect(transport).toHaveBeenCalledTimes(4);
  });
});

describe('short catalog reuse', () => {
  it('reuses the catalog for one minute, preserves isolation, and honors force refresh', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async () => reply({ sources: [{ id: 'one', name: 'One' }] }));
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    const first = await api.sources(); first.sources[0].name = 'Modified';
    for (let i = 0; i < 20; i++) expect((await api.sources()).sources[0].name).toBe('One');
    expect(transport).toHaveBeenCalledTimes(1);
    await api.sources(true);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_001);
    await api.sources();
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('never retains an invalid catalog as a successful cached response', async () => {
    let attempt = 0;
    const transport = vi.fn(async () => reply(++attempt === 1 ? { sources: [{ id: 'invalid' }] } : { sources: [{ id: 'one', name: 'One' }] }));
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    await expect(api.sources()).rejects.toThrow();
    expect((await api.sources()).sources).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
