import type { Entry } from './model';

/** The feed's link proxy redirects to weixin://, which cannot load as a web page. */
export function wechatProxyArticle(link: string): string | null {
  try {
    const proxy = new URL(link);
    if (proxy.origin !== 'https://wechat2rss.bestblogs.dev' || !/^\/link-proxy\/?$/.test(proxy.pathname)) return null;
    const target = new URL(proxy.searchParams.get('u') || '');
    if (target.origin !== 'https://mp.weixin.qq.com' || target.username || target.password ||
      !/^\/s(?:\/[A-Za-z0-9_-]+)?\/?$/.test(target.pathname)) return null;
    return target.href;
  } catch { return null; }
}

/** WeChat's biz/mid/idx tuple identifies an article across feed URLs with different tracking parameters. */
export function wechatArticleKey(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com' || url.pathname !== '/s') return null;
    const biz = url.searchParams.get('__biz');
    const mid = url.searchParams.get('mid');
    const idx = url.searchParams.get('idx');
    if (!biz || !/^\d+$/.test(mid || '') || !/^\d+$/.test(idx || '')) return null;
    return `${biz}/${mid}/${idx}`;
  } catch { return null; }
}

export function sameWechatArticle(a: Entry, b: Entry): boolean {
  const key = wechatArticleKey(a.link);
  return !!key && a.sourceId === b.sourceId && key === wechatArticleKey(b.link);
}

/** Xiaoyuzhou can return the same episode twice, with and without RSS tracking parameters. */
export function xiaoyuzhouEpisodeKey(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaoyuzhoufm.com') return null;
    return /^\/episode\/([a-z0-9]+)\/?$/i.exec(url.pathname)?.[1].toLowerCase() || null;
  } catch { return null; }
}

export function sameRemoteContent(a: Entry, b: Entry): boolean {
  if (a.sourceId !== b.sourceId) return false;
  const wechat = wechatArticleKey(a.link);
  if (wechat) return wechat === wechatArticleKey(b.link);
  const episode = xiaoyuzhouEpisodeKey(a.link);
  return !!episode && episode === xiaoyuzhouEpisodeKey(b.link);
}

/** Collapse duplicate records only in the displayed list; keep saved articles and source data intact. */
export function uniqueRemoteEntries(entries: Entry[], selectedId?: string): Entry[] {
  const result: Entry[] = [];
  const positions = new Map<string, number>();
  for (const entry of entries) {
    const article = wechatArticleKey(entry.link) || xiaoyuzhouEpisodeKey(entry.link);
    if (!article) { result.push(entry); continue; }
    const key = `${entry.sourceId}:${article}`;
    const position = positions.get(key);
    if (position == null) { positions.set(key, result.length); result.push(entry); continue; }
    const previous = result[position];
    if (entry.id === selectedId || (previous.id !== selectedId && (entry.publishedTs || 0) > (previous.publishedTs || 0))) result[position] = entry;
  }
  return result;
}
