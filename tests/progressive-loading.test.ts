// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
import { curatedPageEntries, loadCuratedPages } from '../src/curated-sources';

afterEach(() => vi.useRealTimers());
const entry = { id: 'ready', sourceId: 'user-submitted', title: 'Ready article', content: '<p>Readable now</p>' };
const response = (value: unknown) => ({ status: 200, text: JSON.stringify(value) });

describe('progressive article loading', () => {
  it('delivers the rewrite without waiting for a stalled translation', async () => {
    vi.useFakeTimers();
    const onContent = vi.fn();
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.endsWith('/translation')) return new Promise(() => {});
      if (url.endsWith('/rewrite')) { await new Promise(resolve => setTimeout(resolve, 10)); return response({ rewrite: { body: 'Preferred rewrite' } }); }
      return response({ entry });
    });
    const pending = api.article(entry.id, undefined, onContent);
    await vi.advanceTimersByTimeAsync(11);
    expect(onContent).toHaveBeenLastCalledWith(expect.objectContaining({ rewrite: { body: 'Preferred rewrite' } }));
    await vi.advanceTimersByTimeAsync(20001);
    expect((await pending).bundle.rewrite?.body).toBe('Preferred rewrite');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('delivers the original before stalled optional versions settle', async () => {
    vi.useFakeTimers();
    const onContent = vi.fn();
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.endsWith('/rewrite') || url.endsWith('/translation')) return new Promise(() => {});
      return response({ entry });
    });
    const pending = api.article(entry.id, undefined, onContent);
    await vi.advanceTimersByTimeAsync(1);
    expect(onContent).toHaveBeenCalledWith(expect.objectContaining({ entry: expect.objectContaining({ content: entry.content }) }));
    await vi.advanceTimersByTimeAsync(20001);
    expect((await pending).warnings).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait for optional versions after primary failure', async () => {
    vi.useFakeTimers();
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.endsWith('/rewrite') || url.endsWith('/translation')) return new Promise(() => {});
      return { status: 503, text: '' };
    });
    const assertion = expect(api.article(entry.id)).rejects.toThrow('HTTP 503');
    await vi.advanceTimersByTimeAsync(301);
    await assertion;
    await vi.advanceTimersByTimeAsync(20001);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps embedded rewrite if the optional endpoint successfully returns no rewrite', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async url => response(url.endsWith('/rewrite') ? { rewrite: null } : url.endsWith('/translation') ? { translation: null } : { entry: { ...entry, rewrite: { body: 'Already available' } } }));
    expect((await api.article(entry.id)).bundle.rewrite?.body).toBe('Already available');
  });
});

describe('independent channel refresh', () => {
  it('shows fast pages and starts the ninth source while the first is still stalled', async () => {
    let release!: (entries: typeof entry[]) => void;
    const started: string[] = [], visible: string[] = [];
    const ids = Array.from({ length: 9 }, (_, i) => String(i));
    const pending = loadCuratedPages(ids, id => {
      started.push(id);
      return id === '0' ? new Promise(resolve => release = resolve) : Promise.resolve([{ ...entry, id, sourceId: id }]);
    }, results => { visible.push(...curatedPageEntries(ids, results, []).map(e => e.id)); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(started).toContain('8');
    expect(visible).toContain('8');
    expect(visible).not.toContain('0');
    release([{ ...entry, id: '0', sourceId: '0' }]);
    await pending;
  });

  it('keeps cached articles from failed sources while respecting successful empty pages', () => {
    const cached = ['failed', 'empty', 'pending'].map(id => ({ ...entry, id, sourceId: id }));
    expect(curatedPageEntries(['failed', 'empty', 'pending'], [{ status: 'rejected', reason: Error('offline') }, { status: 'fulfilled', value: [] }, undefined], cached).map(e => e.id)).toEqual(['failed', 'pending']);
  });

  it('does not start queued sources or publish progress after switching channels', async () => {
    let active = true;
    const progress = vi.fn(), started: string[] = [];
    const pending = loadCuratedPages(Array.from({ length: 10 }, (_, i) => String(i)), async id => { started.push(id); await Promise.resolve(); return [entry]; }, progress, () => active);
    active = false;
    await pending;
    expect(started).toHaveLength(8);
    expect(progress).not.toHaveBeenCalled();
  });
});
