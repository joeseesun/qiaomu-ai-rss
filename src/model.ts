import { z } from 'zod';

export const modeSchema = z.enum(['rewrite', 'translation', 'original']);
export type Mode = z.infer<typeof modeSchema>;
export const modeLabels: Record<Mode, string> = { rewrite: '乔木改写', translation: '中文翻译', original: '原文' };
const optionalText = z.string().nullish();
export const rewriteSchema = z.object({ title: optionalText, body: z.string() });
export const translationSchema = z.object({
  titleZh: optionalText, summaryZh: optionalText,
  content: z.array(z.object({ source: optionalText, target: optionalText, sourceHtml: optionalText, targetHtml: optionalText })).nullish(),
});
export const entrySchema = z.object({
  id: z.string().min(1), sourceId: z.string(), origin: z.enum(['local', 'qiaomu']).optional(), sourceName: optionalText, title: z.string(), titleZh: optionalText,
  link: optionalText, author: optionalText, published: optionalText, publishedTs: z.number().nullish(),
  summary: optionalText, summaryZh: optionalText, content: optionalText,
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
    lastSource: z.string().max(300).default(''),
  }).default({ baseUrl: 'https://rss.qiaomu.ai', folder: 'Qiaomu RSS', rsshubUrl: 'https://rsshub.rssforever.com', defaultMode: 'rewrite', remoteImages: true, listWidth: 300, lastSource: '' }),
  readIds: z.array(z.string()).default([]), favorites: z.record(z.string(), bundleSchema).default({}),
  entries: z.array(entrySchema).default([]), sources: z.array(sourceSchema).default([]),
  subscriptions: z.array(subscriptionSchema).default([]),
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
export function noteName(entry: Entry, mode: Mode): string {
  const title = [...titleOf(entry)].map(c => c.charCodeAt(0) < 32 ? ' ' : c).join('').replace(/[\\/:*?"<>|#[\]^]/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 65) || '未命名文章';
  const id = entry.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  if (!id) throw new Error('文章标识无效。');
  return `${title} - ${id} - ${mode}.md`;
}

export function withServiceOrigin(state: State, baseUrl: string): State {
  return initialState({ settings: { ...state.settings, baseUrl: serviceUrl(baseUrl) }, subscriptions: state.subscriptions,
    favorites: Object.fromEntries(Object.entries(state.favorites).filter(([, bundle]) => bundle.entry.origin === 'local')),
    cache: Object.fromEntries(Object.entries(state.cache).filter(([, bundle]) => bundle.entry.origin === 'local')),
    readIds: state.readIds.filter(id => id.startsWith('local-')) });
}
