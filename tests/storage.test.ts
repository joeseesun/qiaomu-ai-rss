// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attachContentCache, initialState, splitContentCache, stripFeedBodies, type State } from '../src/model';
import { computeSourceStats } from '../src/source-stats';

function stateWithContent(): State {
  return initialState({
    readLater: ['e1'],
    subscriptions: [{ id: 'local:s1', url: 'https://example.com/feed', name: 's1', group: 'g', entries: [
      { id: 'e1', sourceId: 'local:s1', title: 't1', content: '<p>body-one</p>' },
      { id: 'e2', sourceId: 'local:s1', title: 't2' },
    ], updatedAt: 1, error: '' }],
    channelStates: { k: { entries: [{ id: 'e1', sourceId: 'local:s1', title: 't1', content: '<p>body-one</p>' }], bundle: null, mode: 'original', filter: 'all', query: '', unread: [], cursor: '', hasMore: false, listTop: 0, readerTop: 0, articlePending: false } },
  });
}

describe('content-cache split', () => {
  it('defaults readLater to empty and accepts the later filter', () => {
    const fresh = initialState(null);
    expect(fresh.readLater).toEqual([]);
    const later = initialState({ channelStates: { k: { entries: [], bundle: null, mode: 'original', filter: 'later', query: '', unread: [], cursor: '', hasMore: false, listTop: 0, readerTop: 0, articlePending: false } } });
    expect(later.channelStates.k.filter).toBe('later');
  });
  it('moves bodies out of the persisted state and restores them by id', () => {
    const state = stateWithContent();
    const { slim, cache } = splitContentCache(state);
    expect(cache).toEqual({ e1: '<p>body-one</p>' });
    // Slim state carries no body: subscriptions + channelStates both stripped.
    expect(slim.subscriptions[0].entries[0].content).toBeUndefined();
    expect(slim.channelStates.k.entries[0].content).toBeUndefined();
    // Original in-memory state untouched.
    expect(state.subscriptions[0].entries[0].content).toBe('<p>body-one</p>');
    // Slim state round-trips through JSON and rehydrates.
    const revived = initialState(JSON.parse(JSON.stringify(slim)));
    attachContentCache(revived, cache);
    expect(revived.subscriptions[0].entries[0].content).toBe('<p>body-one</p>');
    expect(revived.channelStates.k.entries[0].content).toBe('<p>body-one</p>');
    // Missing cache entries leave metadata intact.
    const bare = initialState(JSON.parse(JSON.stringify(slim)));
    attachContentCache(bare, {});
    expect(bare.subscriptions[0].entries[0].content).toBeUndefined();
    expect(bare.subscriptions[0].entries[0].title).toBe('t1');
  });
  it('queues at most the ids that exist and preserves insertion order', () => {
    const state = stateWithContent();
    expect(state.readLater).toEqual(['e1']);
  });
  it('strips bodies per feed without mutating shared entries', () => {
    const state = stateWithContent();
    const before = state.subscriptions[0].entries[0];
    const { entries, freedBytes, freedCount } = stripFeedBodies(state.subscriptions[0].entries);
    expect(freedCount).toBe(1);
    expect(freedBytes).toBe('<p>body-one</p>'.length);
    expect(entries[0].content).toBeUndefined();
    expect(entries[1]).toBe(state.subscriptions[0].entries[1]);
    // Original object untouched so an open article keeps rendering.
    expect(before.content).toBe('<p>body-one</p>');
  });
  it('ranks sources by recent opens and counts only cached articles', () => {
    const state = initialState({
      readIds: ['a1', 'a2', 'b1'],
      readAt: { a1: Date.now() - 1000, a2: Date.now() - 40 * 86400000, b1: Date.now() - 1000 },
      subscriptions: [
        { id: 's-a', url: 'https://a.example/feed', name: 'sa', group: '', entries: [
          { id: 'a1', sourceId: 's-a', title: 't' }, { id: 'a2', sourceId: 's-a', title: 't' },
        ], updatedAt: 1, error: '' },
        { id: 's-b', url: 'https://b.example/feed', name: 'sb', group: '', entries: [
          { id: 'b1', sourceId: 's-b', title: 't' },
        ], updatedAt: 1, error: '' },
        { id: 's-c', url: 'https://c.example/feed', name: 'sc', group: '', entries: [
          { id: 'c1', sourceId: 's-c', title: 't' },
        ], updatedAt: 1, error: '' },
      ],
    });
    const stats = computeSourceStats(state);
    expect(stats.map(s => s.id)).toEqual(['s-c', 's-b', 's-a']);
    expect(stats.find(s => s.id === 's-a')).toMatchObject({ openedEver: 2, opened30d: 1 });
    expect(stats.find(s => s.id === 's-c')).toMatchObject({ openedEver: 0, opened30d: 0, lastOpen: null });
  });
});
