import { z } from 'zod';

export const modeSchema = z.enum(['rewrite', 'translation', 'original']);
export type Mode = z.infer<typeof modeSchema>;
export const modeLabels: Record<Mode, string> = { rewrite: '乔木改写', translation: '中文翻译', original: '原文' };
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
  id: z.string(), url: z.string(), name: z.string(), group: z.string().default(''),
  entries: z.array(entrySchema).default([]), updatedAt: z.number().default(0), error: z.string().default(''),
  etag: optionalText, lastModified: optionalText, paused: z.boolean().default(false),
  errorCount: z.number().int().default(0), lastErrorAt: z.number().default(0),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export const channelStateSchema = z.object({
  entries: z.array(entrySchema), bundle: bundleSchema.nullable(), mode: modeSchema,
  filter: z.enum(['all', 'unread', 'favorites', 'later']), query: z.string(), unread: z.array(z.string()),
  cursor: z.string(), hasMore: z.boolean(), listTop: z.number().nonnegative(), readerTop: z.number().nonnegative(),
  articlePending: z.boolean(),
});
export type ChannelState = z.infer<typeof channelStateSchema>;
export const stateSchema = z.object({
  settings: z.object({
    baseUrl: z.string().default('https://rss.qiaomu.ai'), folder: z.string().default('Qiaomu RSS'),
    defaultMode: modeSchema.default('rewrite'), remoteImages: z.boolean().default(true), listWidth: z.number().min(220).max(520).default(300),
    fontSize: z.number().int().min(14).max(32).default(19), customFont: z.string().max(200).catch('').default(''), fontFamily: readingFontSchema.default('fangsong'),
    lineHeight: z.number().min(1.5).max(2.4).default(1.9), lineWidth: z.number().int().min(24).max(96).catch(36).default(36),
    selectionPopup: z.boolean().default(true), markdownFolders: z.array(z.string()).default([]), followedPodcasts: z.array(z.string()).default([]), podcastNames: z.record(z.string(), z.string()).default({}),
    exportFolder: z.string().max(500).catch('').default(''), exportFilename: z.string().max(200).catch('{title} - {mode}.md').default('{title} - {mode}.md'),
    exportAssetFolder: z.string().max(500).catch('{filename}.assets').default('{filename}.assets'), askBeforeSave: z.boolean().default(true),
    lastSource: z.string().max(300).default(''),
  }).default({ baseUrl: 'https://rss.qiaomu.ai', folder: 'Qiaomu RSS', defaultMode: 'rewrite', remoteImages: true, listWidth: 300,
    fontSize: 19, fontFamily: 'fangsong', customFont: '', lineHeight: 1.9, lineWidth: 36, lastSource: '', selectionPopup: true, markdownFolders: [], followedPodcasts: [], podcastNames: {},
    exportFolder: '', exportFilename: '{title} - {mode}.md', exportAssetFolder: '{filename}.assets', askBeforeSave: true }),
  readIds: z.array(z.string()).default([]), favorites: z.record(z.string(), bundleSchema).default({}),
  readLater: z.array(z.string()).default([]),
  readAt: z.record(z.string(), z.number()).default({}),
  entries: z.array(entrySchema).default([]), sources: z.array(sourceSchema).default([]),
  subscriptions: z.array(subscriptionSchema).default([]),
  channelStates: z.record(z.string(), channelStateSchema).catch({}).default({}),
  savedArticles: z.record(z.string(), bundleSchema).default({}),
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
  return state;
}
// Content-cache split: entry `content` (95% of persisted bytes) lives in a separate
// cache file so data.json stays small and every persist() is cheap. In-memory
// Entry objects always carry content; split/attach convert at the boundary.
function stripEntry(entry: Entry, cache: Record<string, string>): Entry {
  if (entry.content) { cache[entry.id] = entry.content; return { ...entry, content: undefined }; }
  return entry;
}
export function splitContentCache(state: State): { slim: State; cache: Record<string, string> } {
  const cache: Record<string, string> = {};
  const stripBundle = (bundle: Bundle): Bundle => ({ ...bundle, entry: stripEntry(bundle.entry, cache) });
  const mapBundles = (record: Record<string, Bundle>): Record<string, Bundle> =>
    Object.fromEntries(Object.entries(record).map(([key, bundle]) => [key, stripBundle(bundle)]));
  return {
    slim: {
      ...state,
      subscriptions: state.subscriptions.map(feed => ({ ...feed, entries: feed.entries.map(entry => stripEntry(entry, cache)) })),
      channelStates: Object.fromEntries(Object.entries(state.channelStates).map(([key, cs]) => [key, {
        ...cs, entries: cs.entries.map(entry => stripEntry(entry, cache)),
        bundle: cs.bundle ? stripBundle(cs.bundle) : cs.bundle,
      }])),
      entries: state.entries.map(entry => stripEntry(entry, cache)),
      cache: mapBundles(state.cache), favorites: mapBundles(state.favorites), savedArticles: mapBundles(state.savedArticles),
    },
    cache,
  };
}
// Strip bodies from a feed's entries without mutating shared row objects:
// returns fresh entry objects so an open article (holding the old ref) keeps rendering.
export function stripFeedBodies(entries: Entry[]): { entries: Entry[]; freedBytes: number; freedCount: number } {
  let freedBytes = 0, freedCount = 0;
  const next = entries.map(entry => {
    if (!entry.content) return entry;
    freedBytes += entry.content.length; freedCount++;
    return { ...entry, content: undefined };
  });
  return { entries: next, freedBytes, freedCount };
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
export function titleOf(entry: Entry): string { return entry.titleZh?.trim() || entry.title; }
export function safeUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function serviceUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('请输入 HTTPS 服务地址，不包含路径、账号或查询参数。');
  }
  return url.origin;
}
export function folderPath(value: string): string {
  const segments = value.trim().replace(/\\/g, '/').split('/');
  if (!segments.length || segments.some(s => !s || s.startsWith('.') || /[:*?"<>|]/.test(s) || [...s].some(c => c.charCodeAt(0) < 32))) {
    throw new Error('请输入库内文件夹名称，不包含隐藏目录、空段或特殊字符。');
  }
  return segments.join('/');
}
export function withServiceOrigin(state: State, baseUrl: string): State {
  return initialState({ savedArticles: state.savedArticles, settings: { ...state.settings, baseUrl: serviceUrl(baseUrl) }, subscriptions: state.subscriptions,
    favorites: Object.fromEntries(Object.entries(state.favorites).filter(([, bundle]) => bundle.entry.origin === 'local' || bundle.entry.origin === 'vault')),
    cache: Object.fromEntries(Object.entries(state.cache).filter(([, bundle]) => bundle.entry.origin === 'local' || bundle.entry.origin === 'vault')),
    readIds: state.readIds.filter(id => id.startsWith('local-') || id.startsWith('vault:')) });
}
