import { migrateLibrary } from './personal-library';
import { z } from 'zod';
import { t } from './i18n';

export const modeSchema = z.enum(['rewrite', 'translation', 'original']);
export type Mode = z.infer<typeof modeSchema>;
export function modeLabel(mode: Mode): string {
  return t(mode === 'rewrite' ? 'mode.rewrite' : mode === 'translation' ? 'mode.translation' : 'mode.original');
}
export const readingThemeSchema = z.enum(['auto', 'light', 'paper', 'sage', 'mist', 'dark', 'black']);
export type ReadingTheme = z.infer<typeof readingThemeSchema>;
export const readingFontSchema = z.enum(['serif', 'sans', 'sourceHanSerif', 'sourceHanSans', 'wenkai', 'zhenkai', 'fangsong', 'custom']);
export type ReadingFont = z.infer<typeof readingFontSchema>;
const optionalText = z.string().nullish();
export const rewriteSchema = z.object({ title: optionalText, body: z.string() });
export const translationSchema = z.object({
  titleZh: optionalText, summaryZh: optionalText,
  content: z.array(z.object({ source: optionalText, target: optionalText, sourceHtml: optionalText, targetHtml: optionalText })).nullish(),
});
export const entrySchema = z.object({
  id: z.string().min(1), sourceId: z.string(), origin: z.enum(['local', 'qiaomu', 'vault']).optional(), sourceName: optionalText, title: z.string(), titleZh: optionalText,
  markdownPath: optionalText, markdown: optionalText, podcastSlug: optionalText, episodeSlug: optionalText,
  link: optionalText, videoUrl: optionalText, author: optionalText, published: optionalText, publishedTs: z.number().nullish(),
  publishedRelative: optionalText, podcastViews: z.number().int().nonnegative().nullish(),
  podcastWordCount: z.number().int().nonnegative().nullish(), podcastDurationSeconds: z.number().int().nonnegative().nullish(),
  summary: optionalText, summaryZh: optionalText, content: optionalText, image: optionalText,
  audio: z.object({ url: z.string(), type: optionalText }).nullish(),
  rewrite: rewriteSchema.nullish(),
});
export type Entry = z.infer<typeof entrySchema>;
export const sourceSchema = z.object({ id: z.string(), name: z.string(), category: optionalText, siteUrl: optionalText, enabled: z.boolean().optional() });
export type Source = z.infer<typeof sourceSchema>;
export function podcastDefaultMode(entry: Entry, sources: Source[], followedPodcasts: string[]): Mode | null {
  if (entry.podcastSlug) return 'original';
  return sources.some(source => source.id === entry.sourceId && source.category === 'podcast') || followedPodcasts.includes(entry.sourceId)
    ? 'rewrite' : null;
}
export const bundleSchema = z.object({ entry: entrySchema, rewrite: rewriteSchema.nullable(), translation: translationSchema.nullable(), fetchedAt: z.number() });
export type Bundle = z.infer<typeof bundleSchema>;
export const pageSchema = z.object({ entries: z.array(entrySchema), hasMore: z.boolean().optional(), nextCursor: z.string().nullish() });
export const subscriptionSchema = z.object({
  id: z.string(), url: z.string(), name: z.string(), group: z.string().default(''), site: z.string().optional(), image: z.string().optional(),
  entries: z.array(entrySchema).default([]), updatedAt: z.number().default(0), lastAttemptAt: z.number().default(0), error: z.string().default(''),
  etag: z.string().optional(), lastModified: z.string().optional(),
  paused: z.boolean().default(false), errorCount: z.number().default(0), lastErrorAt: z.number().default(0),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export const channelStateSchema = z.object({
  entries: z.array(entrySchema), bundle: bundleSchema.nullable(), mode: modeSchema,
  filter: z.enum(['all', 'unread', 'favorites', 'later']), query: z.string(), unread: z.array(z.string()),
  cursor: z.string(), hasMore: z.boolean(), listTop: z.number().nonnegative(), readerTop: z.number().nonnegative(),
  articlePending: z.boolean(),
});
export type ChannelState = z.infer<typeof channelStateSchema>;
export const collectionJobSchema = z.object({ id: z.string(), url: z.string(), baseUrl: z.string(), status: z.enum(['queued', 'running', 'complete', 'failed']).default('queued'), title: z.string().default(''), originalTitle: z.string().optional(), entryId: z.string().optional(), notified: z.boolean().default(false), createdAt: z.number() });
export type CollectionJob = z.infer<typeof collectionJobSchema>;
export const stateSchema = z.object({
  libraryVersion: z.number().int().min(0).max(1).default(0),
  subscriptionGroups: z.array(z.object({ id: z.string(), name: z.string(), order: z.number() })).default([]),
  sourceMeta: z.record(z.string(), z.object({ groupId: z.string(), name: z.string().default(''), order: z.number().default(0) })).default({}),
  collapsedGroups: z.array(z.string()).default([]),
  settings: z.object({
    labCollection: z.boolean().default(false), labInviteVerified: z.boolean().default(false), labInviteCode: z.string().max(200).default(''),
    baseUrl: z.string().default('https://rss.qiaomu.ai'), folder: z.string().default('Qiaomu RSS'),
    defaultMode: modeSchema.default('rewrite'), remoteImages: z.boolean().default(true), listWidth: z.number().min(220).max(520).default(300),
    readingTheme: readingThemeSchema.catch('auto').default('auto'),
    fontSize: z.number().int().min(14).max(32).default(19), customFont: z.string().max(200).catch('').default(''), fontFamily: readingFontSchema.default('fangsong'),
    lineHeight: z.number().min(1.5).max(2.4).default(1.9), lineWidth: z.union([z.literal(28), z.literal(36), z.literal(44)]).default(36),
    selectionPopup: z.boolean().default(true), markdownFolders: z.array(z.string()).default([]), followedPodcasts: z.array(z.string()).default([]), podcastNames: z.record(z.string(), z.string()).default({}),
    pickedSourceIds: z.array(z.string().max(120)).max(300).nullable().default(null),
    lastSource: z.string().max(300).default(''), articleFolder: z.string().default('Qiaomu RSS/文章'), pdfDirectory: z.string().default(''),
  }).default({ labCollection: false, labInviteVerified: false, labInviteCode: '', baseUrl: 'https://rss.qiaomu.ai', folder: 'Qiaomu RSS', articleFolder: 'Qiaomu RSS/文章', pdfDirectory: '', defaultMode: 'rewrite', remoteImages: true, listWidth: 300,
    readingTheme: 'auto', fontSize: 19, fontFamily: 'fangsong', customFont: '', lineHeight: 1.9, lineWidth: 36, lastSource: '', selectionPopup: true, markdownFolders: [], followedPodcasts: [], podcastNames: {}, pickedSourceIds: null }),
  collectionIdentity: z.object({ id: z.string(), key: z.string() }).nullable().default(null),
  collectionAdminSession: z.object({ token: z.string(), expiresAt: z.number(), name: z.string(), baseUrl: z.string() }).nullable().default(null),
  collectionJobs: z.array(collectionJobSchema).default([]),
  deletedEntries: z.record(z.string(), z.array(z.string())).default({}),
  readIds: z.array(z.string()).default([]), favorites: z.record(z.string(), bundleSchema).default({}),
  readLater: z.array(z.string()).default([]), readAt: z.record(z.string(), z.number()).catch({}).default({}),
  entries: z.array(entrySchema).default([]), sources: z.array(sourceSchema).default([]),
  subscriptions: z.array(subscriptionSchema).default([]),
  channelStates: z.record(z.string(), channelStateSchema).catch({}).default({}),
  savedArticles: z.record(z.string(), bundleSchema).default({}),
  // "<entry id>|<mode>" → vault path of the note that article was saved as.
  articleNotes: z.record(z.string(), z.string()).catch({}).default({}),
  cache: z.record(z.string(), bundleSchema).default({}), updatedAt: z.number().default(0),
});
export type State = z.infer<typeof stateSchema>;
const podcastSourceUpgrades: Record<string, string> = {
  allin: 'podscribe-all-in-with-chamath-jason-sacks-friedberg',
  joerogan: 'podscribe-the-joe-rogan-experience',
};
export function initialState(data: unknown): State {
  const state = stateSchema.parse(data ?? {});
  state.settings.followedPodcasts = [...new Set(state.settings.followedPodcasts.map(id => podcastSourceUpgrades[id] || id))];
  for (const [oldId, newId] of Object.entries(podcastSourceUpgrades)) {
    if (state.settings.podcastNames[oldId] && !state.settings.podcastNames[newId]) state.settings.podcastNames[newId] = state.settings.podcastNames[oldId];
    delete state.settings.podcastNames[oldId];
  }
  const previousSource = state.settings.lastSource;
  state.settings.lastSource = podcastSourceUpgrades[previousSource] || previousSource;
  if (podcastSourceUpgrades[previousSource] && !state.settings.followedPodcasts.includes(state.settings.lastSource)) {
    state.settings.followedPodcasts.push(state.settings.lastSource);
  }
  const last = state.settings.lastSource;
  if (state.sources.some(source => source.id === last && source.category === 'podcast') && !state.settings.followedPodcasts.includes(last)) {
    state.settings.followedPodcasts.push(last);
  }
  migrateLibrary(state);
  return state;
}
export function titleOf(entry: Entry): string { return entry.titleZh?.trim() || entry.title; }
// Content-cache split: entry `content` (~95% of persisted bytes) lives in a rebuildable
// content-cache.json keyed by entry id, so data.json stays small and every persist is cheap.
// In-memory entries always carry content; split/attach convert only at the storage boundary.
export function splitContentCache(state: State): { slim: State; cache: Record<string, string> } {
  const cache: Record<string, string> = {};
  const strip = (entry: Entry): Entry => {
    if (entry.content) { cache[entry.id] = entry.content; return { ...entry, content: undefined }; }
    return entry;
  };
  const mapBundles = (record: Record<string, Bundle>): Record<string, Bundle> =>
    Object.fromEntries(Object.entries(record).map(([key, bundle]) => [key, { ...bundle, entry: strip(bundle.entry) }]));
  return {
    slim: {
      ...state,
      subscriptions: state.subscriptions.map(feed => ({ ...feed, entries: feed.entries.map(strip) })),
      channelStates: Object.fromEntries(Object.entries(state.channelStates).map(([key, cs]) => [key, {
        ...cs, entries: cs.entries.map(strip), bundle: cs.bundle ? { ...cs.bundle, entry: strip(cs.bundle.entry) } : cs.bundle,
      }])),
      entries: state.entries.map(strip),
      cache: mapBundles(state.cache), favorites: mapBundles(state.favorites), savedArticles: mapBundles(state.savedArticles),
    },
    cache,
  };
}
export function attachContentCache(state: State, cache: Record<string, string>): void {
  const attach = (entry: Entry): void => { if (!entry.content && typeof cache[entry.id] === 'string') entry.content = cache[entry.id]; };
  for (const feed of state.subscriptions) for (const entry of feed.entries) attach(entry);
  for (const cs of Object.values(state.channelStates)) { for (const entry of cs.entries) attach(entry); if (cs.bundle) attach(cs.bundle.entry); }
  for (const entry of state.entries) attach(entry);
  for (const bundle of Object.values(state.cache)) attach(bundle.entry);
  for (const bundle of Object.values(state.favorites)) attach(bundle.entry);
  for (const bundle of Object.values(state.savedArticles)) attach(bundle.entry);
}
/** Copies entries with bodies stripped, so an open article keeps rendering while the feed frees its bytes. */
export function stripFeedBodies(entries: Entry[]): { entries: Entry[]; freedBytes: number; freedCount: number } {
  let freedBytes = 0, freedCount = 0;
  const next = entries.map(entry => {
    if (!entry.content) return entry;
    freedBytes += new TextEncoder().encode(entry.content).length; freedCount++;
    return { ...entry, content: undefined };
  });
  return { entries: next, freedBytes, freedCount };
}
export function safeUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function serviceUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error(t('error.serviceUrlInvalid'));
  }
  return url.origin;
}
export function folderPath(value: string): string {
  const segments = value.trim().replace(/\\/g, '/').split('/');
  if (!segments.length || segments.some(s => !s || s.startsWith('.') || /[:*?"<>|]/.test(s) || [...s].some(c => c.charCodeAt(0) < 32))) {
    throw new Error(t('error.folderNameInvalid'));
  }
  return segments.join('/');
}
export const articleNoteKey = (entryId: string, mode: Mode) => `${entryId}|${mode}`;
/** Follows a renamed or moved note (or a folder containing notes) so saved-article links keep pointing at it. */
export function renameArticleNotes(notes: Record<string, string>, oldPath: string, newPath: string): boolean {
  let changed = false;
  for (const [key, path] of Object.entries(notes)) {
    if (path === oldPath) { notes[key] = newPath; changed = true; }
    else if (path.startsWith(oldPath + '/')) { notes[key] = newPath + path.slice(oldPath.length); changed = true; }
  }
  return changed;
}
export function withServiceOrigin(state: State, baseUrl: string): State {
  return initialState({ deletedEntries: state.deletedEntries, collectionIdentity: state.collectionIdentity, collectionJobs: state.collectionJobs, savedArticles: state.savedArticles, articleNotes: state.articleNotes, settings: { ...state.settings, baseUrl: serviceUrl(baseUrl) }, subscriptions: state.subscriptions,
    favorites: Object.fromEntries(Object.entries(state.favorites).filter(([, bundle]) => bundle.entry.origin === 'local' || bundle.entry.origin === 'vault')),
    cache: Object.fromEntries(Object.entries(state.cache).filter(([, bundle]) => bundle.entry.origin === 'local' || bundle.entry.origin === 'vault')),
    readIds: state.readIds.filter(id => id.startsWith('local-') || id.startsWith('vault:')) });
}
