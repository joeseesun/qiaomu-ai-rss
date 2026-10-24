import { describe, expect, it } from 'vitest';
import { initialState, type Entry } from '../src/model';
import { applyCuratedPicks, curatedChannels, curatedCommunityChannels, filterCuratedEntries, pickNewCuratedSources, pickedSources } from '../src/curated-sources';
import { qiaomuChannelDivider, qiaomuDividers } from '../src/discovery';
const entry = (sourceId: string, origin?: Entry['origin']): Entry => ({ id: sourceId, sourceId, title: sourceId, ...(origin ? { origin } : {}) });
const sources = [
  { id: 'wechat-hidden', name: 'Hidden account', category: 'article', enabled: true },
  { id: 'disabled', name: 'Disabled blog', category: 'article', enabled: false },
  { id: 'community', name: 'Reader submissions', category: 'community', enabled: true },
];
describe('curated source picks', () => {
  it('distinguishes the default catalog from an explicit empty selection after reload', () => {
    expect(pickedSources(initialState(null))).toBeNull();
    const state = initialState({ settings: { pickedSourceIds: [] }, sources });
    expect([...pickedSources(initialState(JSON.parse(JSON.stringify(state))))!]).toEqual([]);
    expect(curatedChannels(state)).toEqual([]);
    expect(filterCuratedEntries(state, [entry('disabled')])).toEqual([]);
  });
  it('makes selected hidden and disabled channels available without changing server flags', () => {
    const state = initialState({ sources, settings: { pickedSourceIds: ['wechat-hidden', 'disabled', 'community'] } });
    expect(curatedChannels(state).map(source => source.id)).toEqual(['wechat-hidden', 'disabled']);
    expect(curatedCommunityChannels(state).map(source => source.id)).toEqual(['community']);
    expect(state.sources.find(source => source.id === 'disabled')!.enabled).toBe(false);
  });
  it('retains the original editorial channel rules until a selection is saved', () => {
    expect(curatedChannels(initialState({ sources }))).toEqual([]);
    expect(curatedCommunityChannels(initialState({ sources })).map(source => source.id)).toEqual(['community']);
  });
  it('filters every incoming page and survives server catalog replacement', () => {
    const state = initialState({ settings: { pickedSourceIds: ['keep'] } });
    const pages = [[entry('keep'), entry('drop')], [entry('new'), { ...entry('keep'), id: 'keep-2' }]];
    expect(pages.flatMap(page => filterCuratedEntries(state, page)).map(item => item.id)).toEqual(['keep', 'keep-2']);
    state.sources = [{ id: 'new', name: 'New source', enabled: true }];
    expect(state.settings.pickedSourceIds).toEqual(['keep']);
    expect(filterCuratedEntries(state, pages[0]).map(item => item.id)).toEqual(['keep']);
  });
  it('preserves personal feeds, vault notes and followed podcasts even when no curated sources are picked', () => {
    const state = initialState({ settings: { pickedSourceIds: [], followedPodcasts: ['followed'] } });
    const independent = [entry('rss', 'local'), entry('note', 'vault'), entry('followed'), { ...entry('show'), podcastSlug: 'show' }];
    expect(filterCuratedEntries(state, [...independent, entry('curated', 'qiaomu'), entry('legacy')])).toEqual(independent);
  });
  it('prunes cached channel entries and the open bundle while preserving favorites and subscriptions', () => {
    const bundle = { entry: entry('drop'), rewrite: null, translation: null, fetchedAt: 1 };
    const state = initialState({ settings: { pickedSourceIds: ['keep'] }, entries: [entry('keep'), entry('drop')], favorites: { drop: bundle },
      subscriptions: [{ id: 'rss', name: 'RSS', url: 'https://example.com/feed', entries: [entry('rss', 'local')] }],
      channelStates: { channel: { entries: [entry('drop'), entry('rss', 'local')], bundle, mode: 'original', filter: 'all', query: '', unread: [], cursor: '', hasMore: false, listTop: 0, readerTop: 0, articlePending: true } } });
    applyCuratedPicks(state);
    expect(state.entries.map(item => item.id)).toEqual(['keep']);
    expect(state.channelStates.channel.entries.map(item => item.id)).toEqual(['rss']);
    expect(state.channelStates.channel.bundle).toBeNull();
    expect(state.channelStates.channel.articlePending).toBe(false);
    expect(state.favorites.drop).toEqual(bundle);
    expect(state.subscriptions[0].entries).toHaveLength(1);
    state.settings.pickedSourceIds = null;
    expect(filterCuratedEntries(state, [entry('drop')])).toHaveLength(1);
  });
  it('assigns overlapping website and content types to exactly four groups', () => {
    expect(qiaomuDividers).toEqual(['微信公众号', '播客', 'Newsletter', '博客与资讯']);
    const catalog = [
      { id: 'wechat-x', name: 'Newsletter account', category: 'podcast' },
      { id: 'show', name: 'Newsletter show', category: 'podcast', siteUrl: 'https://show.substack.com' },
      { id: 'mail', name: 'Mail', siteUrl: 'https://foo.beehiiv.com' },
      { id: 'news', name: 'News', category: 'news' },
      { id: 'video', name: 'Video', siteUrl: 'https://youtube.com/@video' },
      { id: 'community', name: 'Community', category: 'community' },
    ];
    expect(catalog.map(qiaomuChannelDivider)).toEqual(['微信公众号', '播客', 'Newsletter', '博客与资讯', '博客与资讯', '博客与资讯']);
  });
});

describe('new Qiaomu sources with a custom selection', () => {
  const zh = (id: string) => ({ id, name: id, category: 'podcast', siteUrl: `https://${id.replace(/-zh$/, '')}.qiaomu.ai`, enabled: true });
  const blog = (id: string) => ({ id, name: id, category: 'article', siteUrl: `https://${id}.example`, enabled: true });
  it('picks a source that joins the default catalog after the selection was saved, but only once', () => {
    const state = initialState({ sources: [zh('lex-zh'), blog('news')], settings: { pickedSourceIds: ['news'], knownSourceIds: ['lex-zh', 'news'] } });
    state.sources = [...state.sources, zh('newsite-zh')];
    expect(pickNewCuratedSources(state)).toBe(true);
    expect(state.settings.pickedSourceIds).toEqual(['news', 'newsite-zh']);
    // The reader unticks it again: a later refresh must not bring it back
    state.settings.pickedSourceIds = ['news'];
    expect(pickNewCuratedSources(state)).toBe(false);
    expect(state.settings.pickedSourceIds).toEqual(['news']);
  });
  it('never re-adds a source the reader saw and left unticked', () => {
    const state = initialState({ sources: [zh('lex-zh'), blog('news')], settings: { pickedSourceIds: ['news'], knownSourceIds: ['lex-zh', 'news'] } });
    expect(pickNewCuratedSources(state)).toBe(false);
    expect(state.settings.pickedSourceIds).toEqual(['news']);
  });
  it('migrates a 0.32.2 selection: the eight Chinese close readings are new, older sources stay as picked', () => {
    const state = initialState({ sources: [zh('lex-zh'), zh('mianji-zh'), zh('zhangxiaojun-zh'), blog('news')], settings: { pickedSourceIds: ['news'] } });
    expect(state.settings.knownSourceIds).toBeNull();
    expect(pickNewCuratedSources(state)).toBe(true);
    expect(state.settings.pickedSourceIds).toEqual(['news', 'mianji-zh', 'zhangxiaojun-zh']);
    expect(state.settings.knownSourceIds).toEqual(expect.arrayContaining(['lex-zh', 'mianji-zh', 'zhangxiaojun-zh', 'news']));
  });
  it('leaves the default (unpicked) catalog and an empty catalog alone', () => {
    const defaults = initialState({ sources: [zh('newsite-zh')] });
    expect(pickNewCuratedSources(defaults)).toBe(false);
    expect(defaults.settings.pickedSourceIds).toBeNull();
    const offline = initialState({ settings: { pickedSourceIds: ['news'] } });
    expect(pickNewCuratedSources(offline)).toBe(false);
    expect(offline.settings.knownSourceIds).toBeNull();
  });
});
