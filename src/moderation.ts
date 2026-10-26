import type { Entry, State } from './model';

export function remoteEntry(entry: Entry) { return entry.origin !== 'local' && entry.origin !== 'vault' && !entry.podcastSlug; }
export function applyDeletedEntries(state: State, ids: string[], baseUrl: string) {
  state.deletedEntries[baseUrl] = [...new Set([...(state.deletedEntries[baseUrl] || []), ...ids])];
  const deleted = new Set(state.deletedEntries[baseUrl]);
  const keep = (entry: Entry) => !remoteEntry(entry) || !deleted.has(entry.id);
  for (const [key, channel] of Object.entries(state.channelStates)) {
    if (!key.startsWith(JSON.stringify([baseUrl]).slice(0, -1) + ',')) continue;
    channel.entries = channel.entries.filter(keep);
    if (channel.bundle && !keep(channel.bundle.entry)) { channel.bundle = null; channel.articlePending = false; }
  }
  for (const [key, item] of Object.entries(state.personalArticles)) if (item.baseUrl === baseUrl && !keep(item.bundle.entry)) delete state.personalArticles[key];
  if (baseUrl !== state.settings.baseUrl) return;
  state.entries = state.entries.filter(keep);
  for (const bundles of [state.cache, state.favorites, state.savedArticles]) {
    for (const [key, bundle] of Object.entries(bundles)) if (!keep(bundle.entry)) delete bundles[key];
  }
}
