import type { State } from './model';
import { fail, t } from './i18n';
export interface PersonalSource { id: string; name: string; kind: 'rss' | 'podcast' | 'vault'; groupId: string; url?: string; site?: string; image?: string; detail: string }
/** Group names that mean the same thing (catalogs and OPML files use English categories). */
const groupAliases: Record<string, string> = { podcast: '播客', podcasts: '播客', '播客': '播客', wechat: '公众号', '微信公众号': '公众号', '公众号': '公众号' };
export function groupKey(name: string) { const key = name.trim().toLocaleLowerCase().replace(/\s+/g, ' '); return groupAliases[key] || key; }
export function canonicalGroupName(raw: string) { const name = raw.trim(); return groupAliases[name.toLocaleLowerCase()] || name; }
export function ensureGroup(state: State, raw: string): string {
  const name = canonicalGroupName(raw).slice(0, 100); if (!name) return '';
  const existing = state.subscriptionGroups.find(g => groupKey(g.name) === groupKey(name));
  if (existing) return existing.id;
  const id = crypto.randomUUID(); state.subscriptionGroups.push({ id, name, order: state.subscriptionGroups.length }); return id;
}
export function registerSource(state: State, id: string, group: string) {
  if (!state.sourceMeta[id]) state.sourceMeta[id] = { groupId: ensureGroup(state, group), name: '', order: Object.keys(state.sourceMeta).length };
}
export function migrateLibrary(state: State) {
  for (const feed of state.subscriptions) registerSource(state, feed.id, feed.group);
  for (const id of state.settings.followedPodcasts) registerSource(state, id, '播客');
  for (const path of state.settings.markdownFolders) registerSource(state, `@vault:${path}`, '');
  mergeDuplicateGroups(state);
  const valid = new Set(state.subscriptionGroups.map(g => g.id));
  for (const meta of Object.values(state.sourceMeta)) if (meta.groupId && !valid.has(meta.groupId)) meta.groupId = '';
  if (state.settings.lastSource.startsWith('@group:')) {
    const value = state.settings.lastSource.slice(7), group = state.subscriptionGroups.find(g => g.id === value || g.name === value);
    if (group) state.settings.lastSource = `@group:${group.id}`;
  }
  if (state.libraryVersion === 0 && state.subscriptionGroups.length > 5 && !state.collapsedGroups.length) state.collapsedGroups = state.subscriptionGroups.map(g => g.id);
  state.libraryVersion = 1;
}
/** Folds groups whose names are aliases (“Podcasts” and “播客”) into the earliest one; sources and collapsed state follow. */
export function mergeDuplicateGroups(state: State) {
  const keep = new Map<string, State['subscriptionGroups'][number]>(), moved = new Map<string, string>();
  for (const group of groupsInOrder(state)) {
    const key = groupKey(group.name), first = keep.get(key);
    if (first) moved.set(group.id, first.id); else { keep.set(key, group); if (canonicalGroupName(group.name) !== group.name.trim()) group.name = canonicalGroupName(group.name); }
  }
  if (!moved.size) return false;
  for (const meta of Object.values(state.sourceMeta)) meta.groupId = moved.get(meta.groupId) || meta.groupId;
  const names = new Map([...keep.values()].map(g => [g.id, g.name]));
  for (const feed of state.subscriptions) { const id = state.sourceMeta[feed.id]?.groupId; if (id) feed.group = names.get(id) || feed.group; }
  state.subscriptionGroups = groupsInOrder(state).filter(g => !moved.has(g.id)).map((g, order) => ({ ...g, order }));
  state.collapsedGroups = [...new Set(state.collapsedGroups.map(id => moved.get(id) || id))].filter(id => !moved.has(id));
  const last = state.settings.lastSource.startsWith('@group:') ? moved.get(state.settings.lastSource.slice(7)) : undefined;
  if (last) state.settings.lastSource = `@group:${last}`;
  return true;
}
export function personalSources(state: State): PersonalSource[] {
  const items: Omit<PersonalSource, 'groupId'>[] = [
    ...state.subscriptions.map(f => ({ id: f.id, name: f.name, kind: 'rss' as const, url: f.url, site: f.site, image: f.image, detail: f.error || t('library.cachedArticles', { n: f.entries.length }) })),
    ...state.settings.followedPodcasts.map(id => ({ id, name: state.settings.podcastNames[id] || state.sources.find(s => s.id === id)?.name || id.replace(/^podscribe-/, ''), kind: 'podcast' as const, detail: t('library.kind.podcast') })),
    ...state.settings.markdownFolders.map(path => ({ id: `@vault:${path}`, name: path === '/' ? t('settings.wholeVault') : path.split('/').at(-1) || path, kind: 'vault' as const, detail: path })),
  ];
  return items.map(item => ({ ...item, name: state.sourceMeta[item.id]?.name || item.name, groupId: state.sourceMeta[item.id]?.groupId || '' }))
    .sort((a, b) => (state.sourceMeta[a.id]?.order || 0) - (state.sourceMeta[b.id]?.order || 0));
}
export function groupsInOrder(state: State) { return [...state.subscriptionGroups].sort((a, b) => a.order - b.order); }
export function moveSources(state: State, ids: string[], groupId: string) {
  if (groupId && !state.subscriptionGroups.some(g => g.id === groupId)) fail('error.groupMissing');
  const name = state.subscriptionGroups.find(g => g.id === groupId)?.name || '';
  for (const id of ids) {
    registerSource(state, id, ''); state.sourceMeta[id].groupId = groupId;
    const feed = state.subscriptions.find(f => f.id === id); if (feed) feed.group = name;
  }
}
export function renameGroup(state: State, id: string, raw: string) {
  const name = canonicalGroupName(raw); if (!name || name.length > 100) fail('error.groupNameInvalid');
  const group = state.subscriptionGroups.find(g => g.id === id); if (!group) fail('error.groupMissing');
  // Renaming onto an existing name merges the two groups instead of failing.
  const target = state.subscriptionGroups.find(g => g.id !== id && groupKey(g.name) === groupKey(name));
  if (target) { moveSources(state, personalSources(state).filter(s => s.groupId === id).map(s => s.id), target.id); deleteGroup(state, id); return target.id; }
  group.name = name; moveSources(state, personalSources(state).filter(s => s.groupId === id).map(s => s.id), id); return id;
}
export function deleteGroup(state: State, id: string) {
  moveSources(state, personalSources(state).filter(s => s.groupId === id).map(s => s.id), '');
  state.subscriptionGroups = state.subscriptionGroups.filter(g => g.id !== id);
  state.collapsedGroups = state.collapsedGroups.filter(g => g !== id);
  if (state.settings.lastSource === `@group:${id}`) state.settings.lastSource = '@local';
}
