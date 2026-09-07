import { describe, expect, it } from 'vitest';
import { DEFAULT_RSSHUB, discoveryFeeds, discoveryUrl, filterDiscovery, independentBlogs } from '../src/discovery';
import { initialState, safeUrl, serviceUrl, withServiceOrigin } from '../src/model';

describe('local discovery catalog', () => {
  it('bundles unique safe feed URLs and blog home pages', () => {
    const entries = [...discoveryFeeds, ...independentBlogs];
    expect(new Set(entries.map(feed => feed.id)).size).toBe(entries.length);
    for (const feed of entries) {
      expect(safeUrl(discoveryUrl(feed, DEFAULT_RSSHUB))).not.toBeNull();
      if (feed.site) expect(safeUrl(feed.site)).not.toBeNull();
    }
    expect(new Set(independentBlogs.map(feed => feed.url)).size).toBe(independentBlogs.length);
    expect(entries.some(feed => feed.url === 'https://blog.qiaomu.ai/feed.xml')).toBe(false);
  });
  it('combines local text, category and RSSHub filters', () => {
    expect(filterDiscovery('github 英文', 'AI 与编程', true).map(feed => feed.id)).toEqual(['github']);
    expect(filterDiscovery('nasa', '科技数码', false)).toEqual([]);
    expect(filterDiscovery('', '全部', true).every(feed => !!feed.route)).toBe(true);
    expect(filterDiscovery('no-matches-here', '全部', false)).toEqual([]);
  });
  it('separates large blog catalog and ignores hidden curated filters', () => {
    expect(independentBlogs.length).toBeGreaterThan(1000);
    expect(filterDiscovery('', '科学探索', true, 'blogs')).toHaveLength(independentBlogs.length);
    const blogs = filterDiscovery('diygod', '全部', false, 'blogs', '开源');
    expect(blogs.length).toBeGreaterThan(0);
    expect(blogs.every(feed => feed.tags?.includes('开源'))).toBe(true);
    expect(filterDiscovery('', '全部', false)).toHaveLength(discoveryFeeds.length);
  });
  it('changes only RSSHub catalog URLs, leaves direct feed URLs untouched', () => {
    expect(discoveryUrl(discoveryFeeds.find(feed => feed.id === 'github')!, 'https://hub.example/')).toBe('https://hub.example/github/trending/daily/any');
    expect(discoveryUrl(discoveryFeeds[0], 'https://hub.example')).toBe(discoveryFeeds[0].url);
    for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?token=x', 'javascript:bad']) expect(() => serviceUrl(url)).toThrow();
  });
  it('migrates settings and preserves existing feed URLs across instance and Qiaomu changes', () => {
    const state = initialState({ settings: { folder: 'Notes' }, subscriptions: [{ id: 'test', url: 'https://old.example/36kr/newsflashes', name: 'News' }] });
    expect(state.settings.rsshubUrl).toBe(DEFAULT_RSSHUB);
    state.settings.rsshubUrl = 'https://new.example';
    const next = withServiceOrigin(state, 'https://qiaomu.example');
    expect(next.settings.rsshubUrl).toBe('https://new.example');
    expect(next.subscriptions[0].url).toBe('https://old.example/36kr/newsflashes');
    expect(initialState({ settings: { rsshubUrl: 'malformed' } }).settings.rsshubUrl).toBe(DEFAULT_RSSHUB);
    expect(initialState({ settings: {} }).settings.lastSource).toBe('');
  });
});
