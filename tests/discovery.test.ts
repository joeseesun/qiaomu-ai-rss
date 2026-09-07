import { describe, expect, it } from 'vitest';
import { discoveryFeeds, filterDiscovery, independentBlogs } from '../src/discovery';
import { initialState, safeUrl, withServiceOrigin } from '../src/model';

describe('local discovery catalog', () => {
  it('bundles unique safe feed URLs and blog home pages', () => {
    const entries = [...discoveryFeeds, ...independentBlogs];
    expect(new Set(entries.map(feed => feed.id)).size).toBe(entries.length);
    for (const feed of entries) {
      expect(safeUrl(feed.url)).not.toBeNull();
      if (feed.site) expect(safeUrl(feed.site)).not.toBeNull();
    }
    expect(new Set(independentBlogs.map(feed => feed.url)).size).toBe(independentBlogs.length);
    expect(entries.some(feed => feed.url === 'https://blog.qiaomu.ai/feed.xml')).toBe(false);
  });
  it('keeps nine direct featured feeds separate from RSSHub routes', () => {
    expect(discoveryFeeds).toHaveLength(9);
    expect(discoveryFeeds.every(feed => !!feed.url)).toBe(true);
    expect(filterDiscovery('阮一峰 技术', 'AI 与技术').map(feed => feed.id)).toEqual(['ruanyifeng']);
    expect(filterDiscovery('no-matches-here', '全部')).toEqual([]);
  });
  it('separates large blog catalog and ignores hidden curated filters', () => {
    expect(independentBlogs.length).toBeGreaterThan(1000);
    expect(filterDiscovery('', '人文与生活', 'blogs')).toHaveLength(independentBlogs.length);
    const blogs = filterDiscovery('diygod', '全部', 'blogs', '开源');
    expect(blogs.length).toBeGreaterThan(0);
    expect(blogs.every(feed => feed.tags?.includes('开源'))).toBe(true);
    expect(filterDiscovery('', '全部')).toHaveLength(discoveryFeeds.length);
  });
  it('migrates settings and preserves existing feed URLs across instance and Qiaomu changes', () => {
    const state = initialState({ settings: { folder: 'Notes' }, subscriptions: [{ id: 'test', url: 'https://old.example/36kr/newsflashes', name: 'News' }] });
    const next = withServiceOrigin(state, 'https://qiaomu.example');
    expect(next.subscriptions[0].url).toBe('https://old.example/36kr/newsflashes');
    expect(initialState({ settings: {} }).settings.lastSource).toBe('');
  });
});
