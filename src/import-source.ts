import { requestUrl } from 'obsidian';
import { feedUrl } from './feeds';
import { fail, isLocalizedError, LocalizedError, t } from './i18n';
export function importUrl(value: string) {
  const url = new URL(feedUrl(value));
  if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) { url.hostname = 'raw.githubusercontent.com'; url.pathname = url.pathname.replace('/blob/', '/'); }
  return url.href;
}
export async function readImportUrl(raw: string): Promise<{ url: string; text: string }> {
  const url = importUrl(raw); let timer: number | undefined;
  try {
    const response = await Promise.race([requestUrl({ url, method: 'GET', throw: false }), new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new LocalizedError(t('error.readTimeout'))), 20000); })]);
    if (response.status < 200 || response.status >= 300) fail('error.readFailedHttp', { status: response.status });
    if (new TextEncoder().encode(response.text).length > 5 * 1024 * 1024) fail('error.fileTooLarge');
    return { url, text: response.text };
  } catch (error) { if (isLocalizedError(error)) throw error; fail('error.linkUnreadable'); }
  finally { window.clearTimeout(timer); }
}
