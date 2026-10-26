import { z } from 'zod';
import { serviceUrl, safeUrl, sourceSchema } from './model';
import { t } from './i18n';
import type { CollectionJob } from './model';

const resultSchema = z.object({ status: z.enum(['queued', 'running', 'complete', 'failed']), title: z.string().default(''), originalTitle: z.string().optional(), stage: z.enum(['queued', 'fetch', 'translation', 'rewrite', 'complete']).optional(), failure: z.enum(['timeout', 'quota', 'credentials', 'incomplete', 'network', 'structure', 'unknown']).optional(), entryId: z.string().optional() });
export const collectionItemSchema = resultSchema.extend({ id: z.string(), url: z.string(), createdAt: z.number(), submitter: z.string().optional() });
const pageSchema = z.object({ jobs: z.array(collectionItemSchema), hasMore: z.boolean(), nextCursor: z.string() });
export type CollectionItem = z.infer<typeof collectionItemSchema>;
export type CollectionIdentity = { id: string; key: string };
export function syncCollectionTitles(saved: CollectionJob[], jobs: CollectionItem[], baseUrl: string) {
  const titles = new Map(jobs.map(job => [job.id, job]));
  let changed = false;
  for (const job of saved) {
    const remote = titles.get(job.id);
    if (job.baseUrl !== baseUrl || !remote?.title) continue;
    if (job.title !== remote.title || job.originalTitle !== remote.originalTitle) {
      job.title = remote.title; job.originalTitle = remote.originalTitle; changed = true;
    }
  }
  return changed;
}
type Request = { url: string; method: string; headers: Record<string, string>; body?: string };
export class CollectionClient {
  private base: string;
  constructor(base: string, private invite: string, private transport: (options: Request) => Promise<{ status: number; text: string }>, private identity?: CollectionIdentity) { this.base = serviceUrl(base); }
  private async request<T>(path: string, schema: z.ZodType<T>, body?: unknown, adminToken?: string) {
    let timer: number | undefined;
    const headers: Record<string,string> = { Authorization: `Bearer ${adminToken ?? this.invite.trim()}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    if (this.identity && !path.includes('/admin/')) { headers['X-Qiaomu-Client'] = this.identity.id; headers['X-Qiaomu-Client-Key'] = this.identity.key; }
    const response = await Promise.race([
      this.transport({ url: this.base + path, method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined }),
      new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(t('error.requestTimeout'))), 20000); }),
    ]).finally(() => window.clearTimeout(timer));
    if (response.status === 401 || response.status === 403) throw new Error(t(path.includes('/admin/') ? 'lab.adminDenied' : 'lab.invalidInvite'));
    if (response.status === 404 && !body) throw new Error('COLLECTION_NOT_FOUND');
    if (response.status === 400) throw new Error(t(path.endsWith('/move-entry') ? 'moderation.moveFailed' : 'lab.invalidLink'));
    if (response.status === 429) throw new Error(t('lab.rateLimited'));
    if (response.status < 200 || response.status >= 300) throw new Error(t('lab.unavailable'));
    if (response.text.length > 2000000) throw new Error(t('error.responseTooLarge'));
    const parsed = schema.safeParse(JSON.parse(response.text) as unknown);
    if (!parsed.success) throw new Error(t('error.responseIncompatible'));
    return parsed.data;
  }
  verify(claimIds: string[] = []) {
    if (!this.identity) throw new Error(t('lab.configure'));
    return this.request('/api/lab/verify', z.object({ verified: z.literal(true) }), { clientId: this.identity.id, clientKey: this.identity.key, claimIds });
  }
  submit(id: string, url: string) {
    if (!safeUrl(url)) throw new Error(t('lab.invalidLink'));
    return this.result('/api/lab/collection-jobs', { id, url });
  }
  private async result(path: string, body?: unknown) {
    const result = await this.request(path, resultSchema, body);
    if (result.status === 'complete' && !result.entryId) throw new Error(t('error.responseIncompatible'));
    return result;
  }
  status(id: string) { return this.result(`/api/lab/collection-jobs/${encodeURIComponent(id)}`); }
  list(cursor = '') { return this.request(`/api/lab/collection-jobs?cursor=${encodeURIComponent(cursor)}`, pageSchema); }
  adminLogin(email: string, password: string) { return this.request('/api/lab/admin/session', z.object({ token: z.string(), expiresAt: z.number(), name: z.string() }), { email, password }, ''); }
  listAll(token: string, cursor = '') { return this.request(`/api/lab/admin/collection-jobs?cursor=${encodeURIComponent(cursor)}`, pageSchema, undefined, token); }
  adminChannels(token: string) { return this.request('/api/lab/admin/channels', z.object({ sources: z.array(sourceSchema) }), undefined, token); }
  moveArticle(token: string, entryId: string, sourceId: string) { return this.request('/api/lab/admin/move-entry', z.object({ ok: z.literal(true), entryId: z.string(), sourceId: z.string(), sourceName: z.string() }), { entryId, sourceId }, token); }
  deleteArticle(token: string, entryId: string) { return this.request('/api/lab/admin/delete-entry', z.object({ ok: z.literal(true), entryId: z.string() }), { entryId }, token); }
  logout(token: string) { return this.request('/api/lab/admin/logout', z.object({ verified: z.literal(false) }), {}, token); }
}
