import type { State } from './model';
import { t } from './i18n';

export interface SourceStat {
  id: string; name: string; group: string; entries: number;
  openedEver: number; opened30d: number; lastOpen: number | null;
}
// Pure and cheap: a single pass over cached entries, no serialization.
// Only articles still in cache are counted; rotated-out history is not tracked.
export function computeSourceStats(state: State, now = Date.now()): SourceStat[] {
  const read = new Set(state.readIds);
  const month = 30 * 86400 * 1000;
  const groupName = (id: string) => {
    const groupId = state.sourceMeta[id]?.groupId;
    return groupId ? state.subscriptionGroups.find(group => group.id === groupId)?.name || '' : '';
  };
  return state.subscriptions
    .map(feed => {
      let openedEver = 0, opened30d = 0, lastOpen = 0;
      for (const entry of feed.entries) {
        if (!read.has(entry.id)) continue;
        openedEver++;
        const at = state.readAt[entry.id] ?? 0;
        if (at) { if (now - at < month) opened30d++; if (at > lastOpen) lastOpen = at; }
      }
      return { id: feed.id, name: feed.name, group: groupName(feed.id) || t('common.ungrouped'), entries: feed.entries.length, openedEver, opened30d, lastOpen: lastOpen || null };
    })
    // Sleepers first: sources nobody opened in 30 days top the list for cleanup.
    .sort((a, b) => a.opened30d - b.opened30d || a.openedEver - b.openedEver || b.entries - a.entries);
}
export function formatLastOpen(ts: number | null): string {
  if (!ts) return t('stats.never');
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return t('stats.today');
  if (days === 1) return t('stats.yesterday');
  return t('stats.daysAgo', { n: days });
}
