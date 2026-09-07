// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { articleFragment } from '../src/content';
import { exportOpml, feedUrl, parseFeed, parseOpml } from '../src/feeds';
import { initialState, withServiceOrigin, type Bundle } from '../src/model';
import { Subscriptions } from '../src/subscriptions';
beforeAll(() => { Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); });
const rss = (body = '<p>文章 <img src="/cover.jpg" onerror="evil()"></p>') => `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>RSS &amp; news</title><item><guid>urn:one</guid><title>First</title><link>https://example.com/posts/one</link><pubDate>Mon, 07 Sep 2026 00:00:00 GMT</pubDate><content:encoded><![CDATA[${body}]]></content:encoded></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.org/blog/"><title>Atom</title><entry><id>urn:one</id><title type="html">Hello &amp;lt;b&amp;gt;world&amp;lt;/b&amp;gt;</title><link rel="self" href="entry.xml"/><link href="article"/><updated>2026-09-07T00:00:00Z</updated><content type="xhtml" xml:base="assets/"><div xmlns="http://www.w3.org/1999/xhtml"><p>Body<img src="photo.png"/></p></div></content></entry></feed>`;
describe('feed formats and article identity', () => {
  it('parses RSS content, dates, relative images and stable GUID-based IDs', async () => {
    const first = await parseFeed(rss(), 'https://example.com/feed', document);
    const changed = await parseFeed(rss('<p>Updated</p>').replace('First', 'Renamed'), 'https://example.com/feed', document);
    expect(first.name).toBe('RSS & news'); expect(first.entries[0].id).toBe(changed.entries[0].id);
    expect(first.entries[0].origin).toBe('local'); expect(first.entries[0].publishedTs).toBe(Date.parse('2026-09-07T00:00:00Z'));
    expect(first.entries[0].content).toContain('https://example.com/cover.jpg'); expect(first.entries[0].image).toBe('https://example.com/cover.jpg'); expect(first.entries[0].content).not.toContain('onerror');
    const other = await parseFeed(rss(), 'https://other.example/feed', document);
    expect(first.entries[0].id).not.toBe(other.entries[0].id);
  });
  it('handles Atom namespace, alternate links, XHTML and inherited xml:base', async () => {
    const { entries } = await parseFeed(atom, 'https://example.org/feed.xml', document);
    expect(entries[0].link).toBe('https://example.org/blog/article');
    expect(entries[0].content).toContain('https://example.org/blog/assets/photo.png'); expect(entries[0].image).toBe('https://example.org/blog/assets/photo.png');
    expect(entries[0].content).toContain('Body');
  });
  it('prefers RSS media thumbnails and image enclosures', async () => {
    const xml = '<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Images</title><item><guid>one</guid><title>One</title><media:thumbnail url="/thumb.jpg"/><enclosure url="/large.jpg" type="image/jpeg"/><description>Text</description></item></channel></rss>';
    const { entries } = await parseFeed(xml, 'https://example.com/feed', document);
    expect(entries[0].image).toBe('https://example.com/thumb.jpg');
  });
  it('resolves relative root xml:base only once', async () => {
    const xml = atom.replace('https://example.org/blog/', '../blog/');
    const { entries } = await parseFeed(xml, 'https://example.org/feeds/feed.xml', document);
    expect(entries[0].content).toContain('https://example.org/blog/assets/photo.png');
  });
  it('keeps Atom plain text literal and does not load external content src', async () => {
    const parsed = await parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title><entry><id>id</id><title>Title</title><content type="text">&lt;script&gt;literal&lt;/script&gt;</content></entry></feed>', 'https://example.com/feed', document);
    const bundle: Bundle = { entry: parsed.entries[0], rewrite: null, translation: null, fetchedAt: 1 };
    const fragment = articleFragment(bundle, 'original', document, true)!;
    expect(fragment.querySelector('script')).toBeNull(); expect(fragment.textContent).toContain('<script>literal</script>');
  });
  it('supports RSS 1.0, descriptions, undated items and duplicate GUIDs', async () => {
    const xml = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><channel><title>One</title></channel><item><title>A</title><link>https://example.com/a</link><description>Summary</description></item><item><title>A</title><link>https://example.com/a</link></item></rdf:RDF>';
    const result = await parseFeed(xml, 'https://example.com/feed', document);
    expect(result.entries).toHaveLength(1); expect(result.entries[0].content).toContain('Summary'); expect(result.entries[0].publishedTs).toBeNull();
  });
  it('rejects HTML, malformed XML, DTD, unsafe feed URLs and oversized files', async () => {
    for (const xml of ['<html><body>website</body></html>', '<rss>', '<!DOCTYPE rss><rss/>', ' '.repeat(5 * 1024 * 1024 + 1)]) await expect(parseFeed(xml, 'https://example.com/feed', document)).rejects.toThrow();
    for (const url of ['javascript:evil()', 'file:///etc/passwd', 'https://me:password@example.com/feed']) expect(() => feedUrl(url)).toThrow();
    expect(feedUrl('https://example.com:443/feed#top')).toBe('https://example.com/feed');
  });
  it('bounds feed entry counts and cached payload size', async () => {
    const items = Array.from({ length: 80 }, (_, i) => `<item><guid>${i}</guid><title>${i}</title><description>${'x'.repeat(60000)}</description></item>`).join('');
    const { entries } = await parseFeed(`<rss><channel><title>Large</title>${items}</channel></rss>`, 'https://example.com/feed', document);
    expect(entries.length).toBeGreaterThan(0); expect(entries.length).toBeLessThanOrEqual(50);
    expect(new TextEncoder().encode(JSON.stringify(entries)).length).toBeLessThan(1024 * 1024 + 100);
  });
});
describe('OPML and migration', () => {
  it('round trips groups and XML-special characters', () => {
    const feeds = [{ name: 'News <&> "one"', group: 'Tech / AI & ML', url: 'https://example.com/feed?a=1&b=2' }, { name: 'Ungrouped', group: '', url: 'https://example.org/feed' }];
    expect(parseOpml(exportOpml(feeds), document).feeds).toEqual(feeds);
  });
  it('flattens nested groups and skips duplicate/unsafe URLs', () => {
    const result = parseOpml('<opml><body><outline text="Tech"><outline text="AI"><outline text="A" xmlUrl="https://example.com/feed"/><outline text="B" xmlUrl="https://example.com/feed#x"/><outline xmlUrl="javascript:bad"/></outline></outline></body></opml>', document);
    expect(result.feeds).toEqual([{ name: 'A', url: 'https://example.com/feed', group: 'Tech / AI' }]); expect(result.skipped).toBe(2);
  });
  it('changing Qiaomu origins preserves personal subscriptions, favorites and read state', async () => {
    const state = initialState(null); const service = new Subscriptions(() => state, async () => {}, async () => ({ status: 200, text: rss() }));
    const feed = await service.add('https://example.com/feed', 'Tech', document);
    const local: Bundle = { entry: feed.entries[0], rewrite: null, translation: null, fetchedAt: 1 };
    const remote: Bundle = { ...local, entry: { ...local.entry, origin: 'qiaomu', id: 'remote' } };
    state.favorites[local.entry.id] = local; state.favorites.remote = remote; state.cache[local.entry.id] = local;
    state.readIds = [local.entry.id, 'remote']; state.entries = [remote.entry];
    const next = withServiceOrigin(state, 'https://new.example');
    expect(next.subscriptions).toEqual(state.subscriptions); expect(next.favorites[local.entry.id]).toEqual(local);
    expect(next.cache[local.entry.id]).toEqual(local); expect(next.favorites.remote).toBeUndefined();
    expect(next.readIds).toEqual([local.entry.id]); expect(next.entries).toEqual([]);
  });
  it('preserves v0.1 state when adding empty subscriptions', () => {
    const state = initialState({ readIds: ['existing'], settings: { remoteImages: false, listWidth: 400 } });
    expect(state.subscriptions).toEqual([]); expect(state.readIds).toEqual(['existing']); expect(state.settings.remoteImages).toBe(false);
  });
});
describe('local subscription lifecycle', () => {
  it('adds, rejects duplicates, edits groups and refreshes without duplicating articles', async () => {
    const state = initialState(null), persist = vi.fn(async () => {}), transport = vi.fn(async () => ({ status: 200, text: rss() }));
    const service = new Subscriptions(() => state, persist, transport);
    const feed = await service.add('https://example.com/feed', 'Tech', document);
    await expect(service.add('https://example.com/feed#x', '', document)).rejects.toThrow('已经添加');
    await service.edit(feed.id, 'My feed', 'AI'); await service.refresh([feed.id], document, true);
    expect(state.subscriptions).toHaveLength(1); expect(feed.entries).toHaveLength(1); expect(feed.name).toBe('My feed'); expect(feed.group).toBe('AI');
    expect(transport).toHaveBeenCalledTimes(2); expect(persist).toHaveBeenCalled();
  });
  it('retains cached articles on network failure and redacts private URLs in errors', async () => {
    const state = initialState(null); const transport = vi.fn(async () => ({ status: 200, text: rss() }));
    const service = new Subscriptions(() => state, async () => {}, transport);
    const feed = await service.add('https://example.com/feed?secret=private', '', document);
    transport.mockRejectedValueOnce(new Error('Failed https://example.com/feed?secret=private'));
    await service.refresh([feed.id], document, true);
    expect(feed.entries).toHaveLength(1); expect(feed.error).toContain('无法读取'); expect(feed.error).not.toContain('secret');
  });
  it('imports without fetching, skips existing feeds, and enforces capacity atomically', async () => {
    const state = initialState(null), transport = vi.fn(); const service = new Subscriptions(() => state, async () => {}, transport);
    expect(await service.import([{ url: 'https://example.com/feed', name: 'A', group: 'Tech' }])).toBe(1);
    expect(await service.import([{ url: 'https://example.com/feed', name: 'Overwrite', group: '' }])).toBe(0);
    expect(state.subscriptions[0].name).toBe('A'); expect(transport).not.toHaveBeenCalled();
    await expect(service.import(Array.from({ length: 101 }, (_, i) => ({ url: `https://example.com/feed/${i}`, name: String(i), group: '' })))).rejects.toThrow('超过');
    expect(state.subscriptions).toHaveLength(1);
  });
  it('does not resurrect a feed deleted while its refresh is pending; keeps favorites', async () => {
    const state = initialState(null); let finish!: (value: { status: number; text: string }) => void;
    const transport = vi.fn(async () => ({ status: 200, text: rss() }));
    const service = new Subscriptions(() => state, async () => {}, transport); const feed = await service.add('https://example.com/feed', '', document);
    const bundle: Bundle = { entry: feed.entries[0], rewrite: null, translation: null, fetchedAt: 1 };
    state.cache[bundle.entry.id] = bundle; state.favorites[bundle.entry.id] = bundle;
    transport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refresh = service.refresh([feed.id], document, true); await service.remove(feed.id); finish({ status: 200, text: rss() }); await refresh;
    expect(state.subscriptions).toHaveLength(0); expect(state.cache[bundle.entry.id]).toBeUndefined(); expect(state.favorites[bundle.entry.id]).toEqual(bundle);
  });
  it('surfaces each finished feed while another remains pending and shares its request', async () => {
    const state = initialState(null); let finish!: (value: { status: number; text: string }) => void;
    const transport = vi.fn(async (url: string) => url.includes('slow') ? new Promise<{ status: number; text: string }>(resolve => { finish = resolve; }) : { status: 200, text: rss() });
    const service = new Subscriptions(() => state, async () => {}, transport);
    await service.import([{ url: 'https://example.com/slow', name: 'Slow', group: '' }, { url: 'https://example.com/fast', name: 'Fast', group: '' }]);
    const progress = vi.fn(); const ids = state.subscriptions.map(feed => feed.id);
    const first = service.refresh(ids, document, true, progress);
    const second = service.refresh([ids[0]], document, true);
    await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
    expect(state.subscriptions[1].entries).toHaveLength(1); expect(transport).toHaveBeenCalledTimes(2);
    finish({ status: 200, text: rss() }); await Promise.all([first, second]);
    expect(state.subscriptions[0].entries).toHaveLength(1); expect(progress).toHaveBeenCalledTimes(2);
  });
  it('times out stalled requests', async () => {
    vi.useFakeTimers(); const state = initialState(null);
    const service = new Subscriptions(() => state, async () => {}, () => new Promise(() => {}));
    const assertion = expect(service.add('https://example.com/feed', '', document)).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(20001); await assertion; vi.useRealTimers();
  });
});
