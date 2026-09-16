import type { State } from './model';

export interface SourceStat {
  id: string; name: string; group: string; entries: number;
  openedEver: number; opened30d: number; lastOpen: number | null;
}
// Pure + cheap (single pass over cached entries, no serialization):
// only counts articles still in cache; evicted history is not tracked.
export function computeSourceStats(state: State, now = Date.now()): SourceStat[] {
  const read = new Set(state.readIds);
  const month = 30 * 86400 * 1000;
  return state.subscriptions
    .map(feed => {
      let openedEver = 0, opened30d = 0, lastOpen = 0;
      for (const entry of feed.entries) {
        if (!read.has(entry.id)) continue;
        openedEver++;
        const at = state.readAt[entry.id] ?? 0;
        if (at) { if (now - at < month) opened30d++; if (at > lastOpen) lastOpen = at; }
      }
      return { id: feed.id, name: feed.name, group: feed.group || '未分组', entries: feed.entries.length, openedEver, opened30d, lastOpen: lastOpen || null };
    })
    .sort((a, b) => a.opened30d - b.opened30d || a.openedEver - b.openedEver || b.entries - a.entries);
}
export function formatLastOpen(ts: number | null): string {
  if (!ts) return '从未打开';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}
