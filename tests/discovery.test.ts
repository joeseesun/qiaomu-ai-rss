import { describe, expect, it } from 'vitest';
import { discoveryFeeds, featuredXiaoyuzhouPodcasts, filterDiscovery, independentBlogs, podcastRecommendations, mergeFeaturedPodcasts, qiaomuChannelDivider, qiaomuFeaturedEntries, readerChannelSources, wechatFeeds, xiaoyuzhouPodcasts } from '../src/discovery';
import { initialState, safeUrl, withServiceOrigin } from '../src/model';
import { compareChannelNames } from '../src/channel-order';

describe('local discovery catalog', () => {
  it('bundles unique safe feed URLs and blog home pages', () => {
    const entries = [...discoveryFeeds, ...independentBlogs, ...wechatFeeds];
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
  it('offers eight opt-in WeChat feeds without adding them to featured defaults', () => {
    expect(wechatFeeds).toHaveLength(8);
    expect(filterDiscovery('', '全部')).toHaveLength(discoveryFeeds.length);
    expect(filterDiscovery('', '全部', 'wechat')).toHaveLength(8);
    expect(filterDiscovery('卡兹克', '全部', 'wechat').map(feed => feed.url))
      .toEqual(['https://rss.t5t6.com/weread/MP_WXS_3223096120.xml']);
  });
  it('uses distinct introductions for curated accounts and shows', () => {
    expect(new Set(wechatFeeds.map(feed => feed.description)).size).toBe(wechatFeeds.length);
    expect(podcastRecommendations).toHaveLength(10);
    expect(new Set(podcastRecommendations.map(show => show.description)).size).toBe(podcastRecommendations.length);
  });
  it('offers enabled Xiaoyuzhou sources returned by the Reader service', () => {
    const sources = initialState({ sources: [
      { id: 'latetalk', name: '晚点聊 LateTalk', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/61933ace1b4320461e91fd55', enabled: true },
      { id: 'disabled', name: '停用节目', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/123', enabled: false },
      { id: 'other', name: '其他节目', category: 'podcast', siteUrl: 'https://example.com/podcast/123', enabled: true },
    ] }).sources;
    expect(xiaoyuzhouPodcasts(sources).map(source => source.id)).toEqual(['latetalk']);
  });
  it('mixes each selected Xiaoyuzhou show\'s latest episode into the default feed by date', () => {
    const sources = initialState({ sources: [
      { id: '42zhangjing', name: '42章经', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/42', enabled: true },
      { id: 'nexttoken', name: 'Next Token', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/next', enabled: true },
      { id: 'zhangxiaojun', name: '张小珺', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/zhang', enabled: true },
      { id: 'latetalk', name: '晚点聊', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/late', enabled: false },
    ] }).sources;
    expect(featuredXiaoyuzhouPodcasts(sources).map(source => source.id)).toEqual(['zhangxiaojun', 'nexttoken', '42zhangjing']);
    const entry = (id: string, sourceId: string, day: number) => ({ id, sourceId, title: id, publishedTs: Date.UTC(2026, 8, day) });
    const page = [entry('news-24', 'news', 24), entry('news-22', 'news', 22), entry('news-21', 'news', 21)];
    const episodes = [entry('zhang-3', 'zhangxiaojun', 3), entry('late-23', 'latetalk', 23), entry('news-22', 'news', 22)];
    expect(mergeFeaturedPodcasts(page, episodes, false).map(item => item.id)).toEqual(['news-24', 'late-23', 'news-22', 'news-21']);
    expect(mergeFeaturedPodcasts(page, episodes, true).map(item => item.id)).toEqual(['news-24', 'late-23', 'news-22', 'news-21', 'zhang-3']);
    expect(qiaomuFeaturedEntries([entry('zhang-3', 'zhangxiaojun', 3), entry('news-24', 'news', 24)]).map(item => item.id)).toEqual(['news-24', 'zhang-3']);
  });
  it('shows selected Xiaoyuzhou shows as Qiaomu channels before subscription', () => {
    const source = (id: string, category: string, siteUrl?: string, enabled = true) => ({ id, name: id, category, siteUrl, enabled });
    const xy = (id: string) => source(id, 'podcast', `https://www.xiaoyuzhoufm.com/podcast/${id}`);
    const sources = [source('news', 'news'), source('levelingup', 'article'), xy('zhangxiaojun'), xy('nexttoken'), xy('42zhangjing'), xy('latetalk'), xy('bannatie'),
      source('wechat-bestblogs-2d790e38f8af54c5af77fa5fed687a7c66d34c22', 'article', 'https://mp.weixin.qq.com/'),
      source('lexfridman', 'podcast', 'https://lexfridman.com'), source('allin', 'podcast', 'https://youtube.com', false)];
    expect(readerChannelSources(sources).map(item => item.id)).toEqual(['news', 'zhangxiaojun', 'nexttoken', '42zhangjing', 'latetalk', 'bannatie']);
    expect(readerChannelSources(sources).map(item => item.id)).not.toContain('lexfridman');
    expect(readerChannelSources(sources).map(item => item.id)).not.toContain('allin');
    expect(readerChannelSources(sources).map(item => item.id)).not.toContain('levelingup');
  });
  it('keeps All-In out of Qiaomu featured entries while preserving other shows', () => {
    const entries = [
      { id: 'video', sourceId: 'allin', title: 'YouTube clip' },
      { id: 'transcript', sourceId: 'podscribe-all-in-with-chamath-jason-sacks-friedberg', title: 'All-In episode' },
      { id: 'xiaoyuzhou', sourceId: 'nexttoken', title: 'Next Token episode' },
    ];
    expect(qiaomuFeaturedEntries(entries).map(entry => entry.id)).toEqual(['xiaoyuzhou']);
    expect(entries).toHaveLength(3);
  });
  it('keeps visitor-added WeChat sources out of Qiaomu channels', () => {
    const source = (id: string) => ({ id, name: id, category: 'article', siteUrl: 'https://mp.weixin.qq.com/', enabled: true });
    const sources = [source('wechat-qiaomu'), source('wechat-bestblogs-1c3e3571b1627d23ee9c64521a0b0a41d3fe2987'),
      source('wechat-bestblogs-9645a69180041ff935c458753174fa8bc2061295'), source('wechat-bestblogs-4c5d9bcc2fbfcd1dc81fb67559653f8957ef4760')];
    expect(readerChannelSources(sources).map(item => item.id)).toEqual([
      'wechat-qiaomu', 'wechat-bestblogs-1c3e3571b1627d23ee9c64521a0b0a41d3fe2987',
      'wechat-bestblogs-9645a69180041ff935c458753174fa8bc2061295',
    ]);
  });
  it('adds visual dividers from source locations without changing source identity', () => {
    const source = (id: string, category: string, siteUrl: string) => ({ id, name: id, category, siteUrl });
    expect(qiaomuChannelDivider(source('wechat-qiaomu', 'article', 'https://mp.weixin.qq.com/'))).toBe('微信公众号');
    expect(qiaomuChannelDivider(source('zhangxiaojun', 'podcast', 'https://www.xiaoyuzhoufm.com/podcast/abc'))).toBe('小宇宙');
    expect(qiaomuChannelDivider(source('video', 'podcast', 'https://www.youtube.com/@example'))).toBe('YouTube');
    expect(qiaomuChannelDivider(source('bensbites', 'article', 'https://www.bensbites.com'))).toBe('Newsletter');
    expect(qiaomuChannelDivider(source('producthunt', 'news', 'https://www.producthunt.com'))).toBe('资讯');
    expect(qiaomuChannelDivider(source('qiaomu-blog', 'article', 'https://blog.qiaomu.ai'))).toBe('博客与网站');
  });
  it('sorts channels by Chinese pinyin and English letters within each divider', () => {
    const items = ['张三', '阿里', '百度'].map(name => ({ name, id: name }));
    expect(items.sort(compareChannelNames).map(item => item.name)).toEqual(['阿里', '百度', '张三']);
    const english = ['Zulu', 'alpha', 'Beta'].map(name => ({ name, id: name }));
    expect(english.sort(compareChannelNames).map(item => item.name)).toEqual(['alpha', 'Beta', 'Zulu']);
    const mixed = ['歸藏', 'elsewhere', 'AGENT橘', '李继刚'].map(name => ({ name, id: name }));
    expect(mixed.sort(compareChannelNames).map(item => item.name)).toEqual(['AGENT橘', 'elsewhere', '歸藏', '李继刚']);
  });
  it('migrates settings and preserves existing feed URLs across instance and Qiaomu changes', () => {
    const state = initialState({ settings: { folder: 'Notes' }, subscriptions: [{ id: 'test', url: 'https://old.example/36kr/newsflashes', name: 'News' }] });
    const next = withServiceOrigin(state, 'https://qiaomu.example');
    expect(next.subscriptions[0].url).toBe('https://old.example/36kr/newsflashes');
    expect(initialState({ settings: {} }).settings.lastSource).toBe('');
  });
});

it('preserves channel reading checkpoints across saved-state parsing', () => {
  const checkpoint = { entries: [], bundle: null, mode: 'original', filter: 'unread', query: '文章', unread: ['a'], cursor: 'page-2', hasMore: true, listTop: 620, readerTop: 1420, articlePending: false };
  const state = initialState({ channelStates: { channel: checkpoint } });
  expect(initialState(JSON.parse(JSON.stringify(state))).channelStates.channel).toEqual(checkpoint);
  expect(initialState({ channelStates: { invalid: { listTop: -1 } } }).channelStates).toEqual({});
});
