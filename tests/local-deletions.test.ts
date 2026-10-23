import { describe, expect, it } from 'vitest';
import { initialState, withServiceOrigin, type Entry } from '../src/model';
import { localDeletion, localDeletionMatcher } from '../src/local-deletions';

const entry: Entry = { id: 'one', sourceId: 'author', origin: 'qiaomu', title: 'Article', link: 'https://mp.weixin.qq.com/s?__biz=abc&mid=123&idx=1&scene=2', content: 'Private body' };
describe('personal article deletion', () => {
  it('persists only metadata and blocks refreshed IDs for the same WeChat article', () => {
    const state = initialState({ sources: [{ id: 'author', name: 'Author name' }] });
    state.localDeletedEntries = [localDeletion(state, entry)!];
    const loaded = initialState(JSON.parse(JSON.stringify(state)));
    expect(loaded.localDeletedEntries[0].entry).not.toHaveProperty('content');
    expect(loaded.localDeletedEntries[0].entry.sourceName).toBe('Author name');
    const hidden = localDeletionMatcher(loaded);
    expect(hidden({ ...entry, id: 'new-id', link: entry.link + '&from=timeline' })).toBe(true);
    expect(hidden({ ...entry, id: 'different', link: 'https://mp.weixin.qq.com/s?__biz=abc&mid=124&idx=1' })).toBe(false);
    expect(hidden({ ...entry, sourceId: 'another-author' })).toBe(false);
  });
  it('isolates service origins, local subscriptions and vault files', () => {
    const state = initialState(null);
    state.localDeletedEntries = [localDeletion(state, entry)!];
    const other = withServiceOrigin(state, 'https://other.example');
    expect(other.localDeletedEntries).toEqual(state.localDeletedEntries);
    expect(localDeletionMatcher(other)(entry)).toBe(false);
    expect(localDeletionMatcher(withServiceOrigin(other, state.settings.baseUrl))(entry)).toBe(true);
    expect(localDeletionMatcher(state)({ ...entry, origin: 'local' })).toBe(false);
    expect(localDeletion(state, { ...entry, origin: 'vault', markdownPath: 'Note.md' })).toBeNull();
    const feed = { ...entry, origin: 'local' as const };
    state.localDeletedEntries.push(localDeletion(state, feed)!);
    expect(localDeletionMatcher(withServiceOrigin(state, 'https://other.example'))(feed)).toBe(true);
  });
  it('never changes saved notes, favorites, queues, progress, source data or server deletion state', () => {
    const bundle = { entry, rewrite: null, translation: null, fetchedAt: 1 };
    const state = initialState({ entries: [entry], favorites: { one: bundle }, savedArticles: { one: bundle }, readLater: ['one'], readIds: ['one'], articleNotes: { 'one|original': 'Articles/Note.md' } });
    const before = JSON.stringify(state);
    const record = localDeletion(state, entry)!;
    expect(JSON.stringify(state)).toBe(before);
    state.localDeletedEntries = [record];
    expect(localDeletionMatcher(state)(entry)).toBe(true);
    state.cache = {};
    expect(localDeletionMatcher(initialState(JSON.parse(JSON.stringify(state))))(entry)).toBe(true);
    state.localDeletedEntries = [];
    expect(JSON.stringify(state)).toBe(before);
  });
  it('uses URL fallbacks conservatively and retains old deletion records without a time limit', () => {
    const state = initialState(null), web = { ...entry, link: 'https://example.com/article?part=1#heading' };
    const record = localDeletion(state, web)!; record.deletedAt = 1; state.localDeletedEntries = [record];
    const hidden = localDeletionMatcher(initialState(state));
    expect(hidden({ ...web, id: 'changed', link: 'https://example.com/article?part=1#other' })).toBe(true);
    expect(hidden({ ...web, id: 'changed', link: 'https://example.com/article?part=2' })).toBe(false);
    expect(initialState(null).localDeletedEntries).toEqual([]);
  });
});
