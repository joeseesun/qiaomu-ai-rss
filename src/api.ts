import { z } from 'zod';
import { bundleSchema, entrySchema, pageSchema, rewriteSchema, serviceUrl, sourceSchema, translationSchema, type Bundle } from './model';
const remoteEntrySchema = entrySchema.transform(entry => ({ ...entry, origin: 'qiaomu' as const, markdown: undefined, markdownPath: undefined }));
export interface HttpResponse { status: number; text: string }
export type Transport = (url: string) => Promise<HttpResponse>;
export class RssApi {
  private base: string;
  constructor(base: string, private transport: Transport) { this.base = serviceUrl(base); }
  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    let timer: number | undefined;
    try {
      const result = await Promise.race([
        this.transport(this.base + path),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('请求超时，请重试。')), 20000); }),
      ]);
      if (result.status < 200 || result.status >= 300) throw new Error(`服务暂不可用（HTTP ${result.status}）。`);
      if (result.text.length > 12_000_000) throw new Error('服务返回的数据过大。');
      const parsed = schema.safeParse(JSON.parse(result.text) as unknown);
      if (!parsed.success) throw new Error('服务返回的数据格式不兼容。');
      return parsed.data;
    } finally { window.clearTimeout(timer); }
  }
  sources() { return this.get('/api/sources?ready=rewrite', z.object({ sources: z.array(sourceSchema) })); }
  entries(source = '', cursor = '') {
    const query = new URLSearchParams({ limit: source ? '40' : '100', ready: 'rewrite' });
    if (cursor) query.set('cursor', cursor);
    const path = source ? `/api/sources/${encodeURIComponent(source)}/entries` : '/api/entries';
    return this.get(`${path}?${query}`, pageSchema.extend({ entries: z.array(remoteEntrySchema) }));
  }
  async article(id: string): Promise<{ bundle: Bundle; warnings: string[] }> {
    const path = `/api/entry/${encodeURIComponent(id)}`;
    const [detail, rewrite, translation] = await Promise.allSettled([
      this.get(path, z.object({ entry: remoteEntrySchema })),
      this.get(`${path}/rewrite`, z.object({ rewrite: rewriteSchema.nullable() })),
      this.get(`${path}/translation`, z.object({ translation: translationSchema.nullable() })),
    ]);
    if (detail.status === 'rejected') throw detail.reason;
    const warnings: string[] = [];
    if (rewrite.status === 'rejected') warnings.push('改写暂时无法加载');
    if (translation.status === 'rejected') warnings.push('翻译暂时无法加载');
    const bundle = bundleSchema.parse({ entry: detail.value.entry,
      rewrite: rewrite.status === 'fulfilled' ? rewrite.value.rewrite : detail.value.entry.rewrite ?? null,
      translation: translation.status === 'fulfilled' ? translation.value.translation : null, fetchedAt: Date.now() });
    return { bundle, warnings };
  }
}
