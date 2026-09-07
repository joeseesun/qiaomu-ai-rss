import { z } from 'zod';

export const modeSchema = z.enum(['rewrite', 'translation', 'original']);
export type Mode = z.infer<typeof modeSchema>;
export const modeLabels: Record<Mode, string> = { rewrite: '乔木改写', translation: '中文翻译', original: '原文' };
export const readingFontSchema = z.enum(['serif', 'sans', 'sourceHanSerif', 'sourceHanSans', 'wenkai', 'zhenkai', 'fangsong']);
export type ReadingFont = z.infer<typeof readingFontSchema>;
const optionalText = z.string().nullish();
export const rewriteSchema = z.object({ title: optionalText, body: z.string() });
export const translationSchema = z.object({
  titleZh: optionalText, summaryZh: optionalText,
  content: z.array(z.object({ source: optionalText, target: optionalText, sourceHtml: optionalText, targetHtml: optionalText })).nullish(),
});
export const entrySchema = z.object({
  id: z.string().min(1), sourceId: z.string(), origin: z.enum(['local', 'qiaomu']).optional(), sourceName: optionalText, title: z.string(), titleZh: optionalText,
  link: optionalText, author: optionalText, published: optionalText, publishedTs: z.number().nullish(),
  summary: optionalText, summaryZh: optionalText, content: optionalText, image: optionalText,
  rewrite: rewriteSchema.nullish(),
});
export type Entry = z.infer<typeof entrySchema>;
export const sourceSchema = z.object({ id: z.string(), name: z.string(), category: optionalText, enabled: z.boolean().optional() });
export type Source = z.infer<typeof sourceSchema>;
export const bundleSchema = z.object({ entry: entrySchema, rewrite: rewriteSchema.nullable(), translation: translationSchema.nullable(), fetchedAt: z.number() });
export type Bundle = z.infer<typeof bundleSchema>;
export const pageSchema = z.object({ entries: z.array(entrySchema), hasMore: z.boolean().optional(), nextCursor: z.string().nullish() });
export const subscriptionSchema = z.object({
  id: z.string(), url: z.string(), name: z.string(), group: z.string().default(''),
  entries: z.array(entrySchema).default([]), updatedAt: z.number().default(0), error: z.string().default(''),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export const stateSchema = z.object({
  settings: z.object({
    baseUrl: z.string().default('https://rss.qiaomu.ai'), folder: z.string().default('Qiaomu RSS'),
    rsshubUrl: z.string().transform(value => { try { return serviceUrl(value); } catch { return 'https://rsshub.rssforever.com'; } }).default('https://rsshub.rssforever.com'),
    defaultMode: modeSchema.default('rewrite'), remoteImages: z.boolean().default(true), listWidth: z.number().min(220).max(520).default(300),
    fontSize: z.number().int().min(14).max(32).default(19), fontFamily: readingFontSchema.default('serif'),
    lineHeight: z.number().min(1.5).max(2.4).default(1.9), lineWidth: z.union([z.literal(28), z.literal(36), z.literal(44)]).default(36),
    lastSource: z.string().max(300).default(''),
  }).default({ baseUrl: 'https://rss.qiaomu.ai', folder: 'Qiaomu RSS', rsshubUrl: 'https://rsshub.rssforever.com', defaultMode: 'rewrite', remoteImages: true, listWidth: 300,
    fontSize: 19, fontFamily: 'serif', lineHeight: 1.9, lineWidth: 36, lastSource: '' }),
  readIds: z.array(z.string()).default([]), favorites: z.record(z.string(), bundleSchema).default({}),
  entries: z.array(entrySchema).default([]), sources: z.array(sourceSchema).default([]),
  subscriptions: z.array(subscriptionSchema).default([]),
  savedArticles: z.record(z.string(), bundleSchema).default({}),
  cache: z.record(z.string(), bundleSchema).default({}), updatedAt: z.number().default(0),
});
export type State = z.infer<typeof stateSchema>;
export function initialState(data: unknown): State { return stateSchema.parse(data ?? {}); }
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
    favorites: Object.fromEntries(Object.entries(state.favorites).filter(([, bundle]) => bundle.entry.origin === 'local')),
    cache: Object.fromEntries(Object.entries(state.cache).filter(([, bundle]) => bundle.entry.origin === 'local')),
    readIds: state.readIds.filter(id => id.startsWith('local-')) });
}
