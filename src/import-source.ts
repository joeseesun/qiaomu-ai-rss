import { requestUrl } from 'obsidian';
import { feedUrl } from './feeds';
export function importUrl(value: string) {
  const url = new URL(feedUrl(value));
  if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) { url.hostname = 'raw.githubusercontent.com'; url.pathname = url.pathname.replace('/blob/', '/'); }
  return url.href;
}
export async function readImportUrl(raw: string): Promise<{ url: string; text: string }> {
  const url = importUrl(raw); let timer: number | undefined;
  try {
    const response = await Promise.race([requestUrl({ url, method: 'GET', throw: false }), new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('读取超时，请重试。')), 20000); })]);
    if (response.status < 200 || response.status >= 300) throw new Error(`读取失败（HTTP ${response.status}）。`);
    if (new TextEncoder().encode(response.text).length > 5 * 1024 * 1024) throw new Error('文件超过 5 MB。');
    return { url, text: response.text };
  } catch (error) { if (error instanceof Error && /^(读取|文件)/.test(error.message)) throw error; throw new Error('无法读取链接，请检查地址或网络。'); }
  finally { window.clearTimeout(timer); }
}
