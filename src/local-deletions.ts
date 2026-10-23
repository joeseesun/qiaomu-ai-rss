import { localDeletionSchema, serviceUrl, type Entry, type LocalDeletion, type State } from './model';
import { wechatArticleKey, wechatProxyArticle, xiaoyuzhouEpisodeKey } from './wechat-articles';

/** Keep content identity source-scoped: equal titles and unrelated URL parameters are not identities. */
export function deletionIdentity(state: State, entry: Entry) {
  if (entry.origin === 'vault' || entry.markdownPath) return null;
  const scope = entry.origin === 'local' ? `local:${entry.sourceId}` : serviceUrl(state.settings.baseUrl);
  const prefix = [scope, entry.sourceId];
  const keys = [JSON.stringify([...prefix, 'id', entry.id])];
  const link = wechatProxyArticle(entry.link || '') || entry.link;
  if (link) {
    const known = wechatArticleKey(link) || xiaoyuzhouEpisodeKey(link);
    if (known) keys.push(JSON.stringify([...prefix, 'content', known]));
    else {
      try {
        const url = new URL(link);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          url.hash = ''; keys.push(JSON.stringify([...prefix, 'url', url.href]));
        }
      } catch { /* IDs remain usable for entries without an absolute web URL. */ }
    }
  }
  return { scope, keys };
}

export function localDeletionMatcher(state: State) {
  const keys = new Set(state.localDeletedEntries.flatMap(record => record.keys));
  return (entry: Entry) => deletionIdentity(state, entry)?.keys.some(key => keys.has(key)) || false;
}

/** Only the tombstone is persisted; source entries, saved bundles and reading state stay untouched. */
export function localDeletion(state: State, entry: Entry): LocalDeletion | null {
  const identity = deletionIdentity(state, entry);
  const sourceName = entry.sourceName || state.sources.find(source => source.id === entry.sourceId)?.name ||
    state.subscriptions.find(feed => feed.id === entry.sourceId)?.name || state.settings.podcastNames[entry.sourceId] || '';
  return identity ? localDeletionSchema.parse({ ...identity, entry: { ...entry, sourceName }, deletedAt: Date.now() }) : null;
}
