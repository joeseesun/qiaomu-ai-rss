import type { Entry, Source, State } from './model';
import { communityChannelSources, readerChannelSources } from './discovery';

/** Release each worker when its source settles; slow sources cannot hold a whole batch. */
export async function loadCuratedPages(ids: string[], fetch: (id: string) => Promise<Entry[]>, progress: (results: (PromiseSettledResult<Entry[]> | undefined)[]) => void, current: () => boolean = () => true) {
  const results = new Array<PromiseSettledResult<Entry[]> | undefined>(ids.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
    while (next < ids.length && current()) {
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await fetch(ids[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
      if (current()) progress(results);
    }
  }));
  return results;
}

/** Failed and unfinished sources keep their cached page; a successful empty page replaces it. */
export function curatedPageEntries(ids: string[], results: (PromiseSettledResult<Entry[]> | undefined)[], cached: Entry[]): Entry[] {
  const pending = new Set(ids.filter((_, index) => results[index]?.status !== 'fulfilled'));
  return [...new Map([...cached.filter(entry => pending.has(entry.sourceId)), ...results.flatMap(result => result?.status === 'fulfilled' ? result.value : [])].map(entry => [entry.id, entry])).values()].sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0));
}

export function pickedSources(state: State): Set<string> | null {
  return state.settings.pickedSourceIds === null ? null : new Set(state.settings.pickedSourceIds);
}
export function curatedChannels(state: State): Source[] {
  const picked = pickedSources(state);
  return picked === null ? readerChannelSources(state.sources) : state.sources.filter(source => picked.has(source.id) && source.category !== 'community');
}
export function curatedCommunityChannels(state: State): Source[] {
  const picked = pickedSources(state);
  return picked === null ? communityChannelSources(state.sources) : state.sources.filter(source => picked.has(source.id) && source.category === 'community');
}
/** Personal RSS, vault notes and explicitly followed shows are independent of curated picks. */
export function keepCuratedEntry(state: State, entry: Entry): boolean {
  const picked = state.settings.pickedSourceIds;
  return picked === null || entry.origin === 'local' || entry.origin === 'vault' || !!entry.podcastSlug || state.settings.followedPodcasts.includes(entry.sourceId) || picked.includes(entry.sourceId);
}
export function filterCuratedEntries(state: State, entries: Entry[]): Entry[] {
  return entries.filter(entry => keepCuratedEntry(state, entry));
}
export function applyCuratedPicks(state: State): void {
  if (state.settings.pickedSourceIds === null) return;
  state.entries = filterCuratedEntries(state, state.entries);
  for (const channel of Object.values(state.channelStates)) {
    channel.entries = filterCuratedEntries(state, channel.entries);
    if (channel.bundle && !keepCuratedEntry(state, channel.bundle.entry)) { channel.bundle = null; channel.articlePending = false; }
  }
}
