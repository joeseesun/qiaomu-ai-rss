import { describe, expect, it } from 'vitest';
import { attachContentCache, channelStateSchema, initialState, splitContentCache, stripFeedBodies, subscriptionSchema, type Bundle, type Entry } from '../src/model';
import { computeSourceStats, formatLastOpen } from '../src/source-stats';

const entry = (id: string, content = ''): Entry => ({ id, sourceId: 's1', title: `T ${id}`, content });
const feedWith = (id: string, entries: Entry[]) => subscriptionSchema.parse({ id, url: `https://example.com/${id}`, name: id, entries, updatedAt: 1 });

describe('content cache split', () => {
  it('moves entry bodies into a rebuildable cache and restores them unchanged', () => {
    const state = initialState(null);
    const body = '<p>body text</p>';
    const shared: Entry = entry('e1', body);
    state.subscriptions.push(feedWith('f1', [shared]));
    state.entries.push(entry('e2', body));
    const bundle: Bundle = { entry: entry('e3', body), rewrite: null, translation: null, fetchedAt: 1 };
    state.cache.e3 = bundle;
    state.channelStates['@local'] = channelStateSchema.parse({ entries: [entry('e4', body)], bundle: { entry: entry('e5', body), rewrite: null, translation: null, fetchedAt: 2 }, mode: 'original', filter: 'all', query: '', unread: [], cursor: '', hasMore: false, listTop: 0, readerTop: 0, articlePending: false });

    const { slim, cache } = splitContentCache(state);
    expect(Object.keys(cache).sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(slim.subscriptions[0].entries[0].content).toBeUndefined();
    expect(slim.entries[0].content).toBeUndefined();
    expect(slim.cache.e3.entry.content).toBeUndefined();
    expect(slim.channelStates['@local'].bundle!.entry.content).toBeUndefined();
    // Titles and summaries stay in the slim state so the list still renders.
    expect(slim.subscriptions[0].entries[0].title).toBe('T e1');
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(state).length);

    attachContentCache(slim, cache);
    expect(slim.subscriptions[0].entries[0].content).toBe(body);
    expect(slim.entries[0].content).toBe(body);
    expect(slim.cache.e3.entry.content).toBe(body);
    expect(slim.channelStates['@local'].bundle!.entry.content).toBe(body);
    // The original state is untouched.
    expect(state.subscriptions[0].entries[0].content).toBe(body);
  });
  it('attaches nothing when the cache is missing (cold start or cleared bodies)', () => {
    const state = initialState(null);
    state.subscriptions.push(feedWith('f1', [entry('e1', 'body')]));
    const { slim, cache } = splitContentCache(state);
    expect(Object.keys(cache)).toHaveLength(1);
    attachContentCache(slim, {});
    expect(slim.subscriptions[0].entries[0].content).toBeUndefined();
  });
  it('stripFeedBodies copies entries, counts freed bytes and skips empty bodies', () => {
    const entries = [entry('a', 'x'.repeat(100)), entry('b', ''), entry('c', 'y'.repeat(50))];
    const { entries: stripped, freedBytes, freedCount } = stripFeedBodies(entries);
    expect(stripped[0].content).toBeUndefined();
    expect(stripped[1].content).toBe('');
    expect(stripped[2].content).toBeUndefined();
    expect(freedCount).toBe(2);
    expect(freedBytes).toBe(150);
    expect(entries[0].content).toBe('x'.repeat(100));
  });
});

describe('source stats', () => {
  it('counts opens per feed, ranks sleepers first and resolves group names', () => {
    const now = Date.now();
    const state = initialState(null);
    state.subscriptionGroups.push({ id: 'g1', name: 'Tech', order: 0 });
    state.sourceMeta.f1 = { groupId: 'g1', name: 'F1', order: 0 };
    state.subscriptions.push(feedWith('f1', [entry('a'), entry('b'), entry('c')]));
    state.subscriptions.push(feedWith('f2', [entry('d')]));
    state.readIds = ['a', 'b', 'd'];
    state.readAt = { a: now - 3600_000, b: now - 90 * 86400_000, d: now - 86400_000 * 2 };
    const stats = computeSourceStats(state, now);
    expect(stats.map(stat => stat.id)).toEqual(['f2', 'f1']);
    const f1 = stats[1];
    expect(f1.group).toBe('Tech'); expect(f1.entries).toBe(3);
    expect(f1.openedEver).toBe(2); expect(f1.opened30d).toBe(1); expect(f1.lastOpen).toBe(now - 3600_000);
    expect(stats[0].opened30d).toBe(1); expect(stats[0].openedEver).toBe(1);
    expect(formatLastOpen(now)).not.toBe(formatLastOpen(null));
    expect(formatLastOpen(now)).toBeTruthy();
  });
  it('keeps feeds with no opens at the top with a never label', () => {
    const state = initialState(null);
    state.subscriptions.push(feedWith('f1', [entry('a')]));
    const stats = computeSourceStats(state);
    expect(stats[0]).toMatchObject({ id: 'f1', openedEver: 0, opened30d: 0, lastOpen: null });
    expect(formatLastOpen(null)).toBeTruthy();
  });
});
