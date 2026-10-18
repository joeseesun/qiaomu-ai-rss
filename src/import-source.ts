import { requestUrl } from 'obsidian';
import { feedUrl } from './feeds';
import { TaskPool } from './task-pool';
import { fail, isLocalizedError, LocalizedError, t } from './i18n';
export function importUrl(value: string) {
  const url = new URL(feedUrl(value));
  if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) { url.hostname = 'raw.githubusercontent.com'; url.pathname = url.pathname.replace('/blob/', '/'); }
  return url.href;
}
export interface ImportDocument { url: string; text: string; headers?: Record<string, string>; finalUrl?: string }
// Share only in-flight transports. A UI timeout never frees a still-running network slot.
const pool = new TaskPool(3);
const pending = new Map<string, Promise<ImportDocument>>();
export async function readImportUrl(raw: string, current: () => boolean = () => true, timeout = 30000): Promise<ImportDocument> {
  const url = importUrl(raw); let timer: number | undefined;
  try {
    if (!current()) fail('source.cancelled');
    let request = pending.get(url);
    if (!request) {
      const expires = Date.now() + timeout;
      request = pool.run(async () => {
        const response = await requestUrl({ url, method: 'GET', throw: false });
        if (response.status < 200 || response.status >= 300) fail('error.readFailedHttp', { status: response.status });
        if (new TextEncoder().encode(response.text).length > 5 * 1024 * 1024) fail('error.fileTooLarge');
        return { url, text: response.text, headers: Object.fromEntries(Object.entries(response.headers || {}).map(([key, value]) => [key.toLowerCase(), value])) };
      }, () => current() && Date.now() < expires).finally(() => pending.delete(url));
      pending.set(url, request);
    }
    return await Promise.race([request, new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new LocalizedError(t('error.readTimeout'))), timeout); })]);
  } catch (error) { if (isLocalizedError(error)) throw error; fail('error.linkUnreadable'); }
  finally { window.clearTimeout(timer); }
}
