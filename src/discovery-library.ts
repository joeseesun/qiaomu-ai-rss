import { z } from 'zod';
import tidings from './data/tidings.json';
import { discoveryFeeds, independentBlogs, podcastRecommendations, wechatFeeds } from './discovery';
import { feedUrl } from './feeds';
export type DiscoverKind = 'wechat' | 'podcast' | 'blogs' | 'more';
export interface DiscoverSource { id: string; name: string; url?: string; site?: string; image?: string; podcastId?: string; kind: DiscoverKind; description: string; group: string; language: string; provenance: string; recommended?: boolean; tags?: string[] }
const feedSchema = z.object({ id: z.string(), title: z.string(), feed_url: z.string(), site_url: z.string().optional(), description: z.string().default(''), category: z.string(), kind: z.string(), language: z.string(), packs: z.array(z.string()), validated_at: z.string().optional() });
export const tidingsSchema = z.object({ generated_at: z.string().optional(), generatedAt: z.string().optional(), feeds: z.array(feedSchema).max(5000) });
export type TidingsData = z.infer<typeof tidingsSchema>;
export const tidingsSnapshot: TidingsData = tidingsSchema.parse(tidings);
export const tidingsSource = tidings.source;
export function tidingsItems(data: TidingsData): DiscoverSource[] {
  return data.feeds.flatMap(feed => { try { return [{ id: `tidings-${feed.id}`, name: feed.title, url: feedUrl(feed.feed_url), site: feed.site_url, description: feed.description, group: feed.category, language: feed.language === 'zh' ? '中文' : '英文', provenance: 'Tidings · 目录收录', tags: feed.packs, kind: feed.packs.includes('wechat') ? 'wechat' as const : feed.kind === 'podcast' || feed.packs.includes('podcasts') ? 'podcast' as const : feed.packs.includes('blogs') ? 'blogs' as const : 'more' as const }]; } catch { return []; } });
}
export const typeLabels: Record<DiscoverKind, string> = { wechat: '公众号', podcast: '播客', blogs: '独立博客', more: '其他来源' };
export type DiscoverCollection = 'wechat' | 'podcast' | 'blogs';
export const collectionLabels: Record<DiscoverCollection, string> = { wechat: '公众号', podcast: '播客', blogs: '独立博客和其他' };
export function inCollection(item: DiscoverSource, collection: DiscoverCollection) { return collection === 'blogs' ? item.kind === 'blogs' || item.kind === 'more' : item.kind === collection; }
export function baseDiscovery(data = tidingsSnapshot): DiscoverSource[] {
  return dedupeDiscovery([
    ...discoveryFeeds.map(f => ({ id: f.id, name: f.name, url: f.url, site: f.site, description: f.description, group: f.category, language: f.language, provenance: '编辑推荐', recommended: true, kind: 'blogs' as const })),
    ...wechatFeeds.map(f => ({ id: f.id, name: f.name, url: f.url, description: f.description, group: '微信公众号', language: '中文', provenance: '编辑推荐', recommended: true, kind: 'wechat' as const })),
    ...podcastRecommendations.map(f => ({ id: f.sourceId, podcastId: f.sourceId, name: f.name, description: `${f.nameZh} · ${f.description}`, group: '播客', language: '英文', provenance: '编辑推荐', recommended: true, kind: 'podcast' as const })),
    ...tidingsItems(data),
    ...independentBlogs.map(f => ({ id: f.id, name: f.name, url: f.url, site: f.site, description: f.description, group: '独立博客', language: f.language, provenance: '中文独立博客列表 · 目录收录', kind: 'blogs' as const, tags: f.tags })),
  ]);
}
const siteKey = (value?: string) => { try { const url = new URL(value!); return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`; } catch { return ''; } };
const nameKey = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
/** Keys that identify the same source across catalogs: feed URL (scheme-insensitive), name + site, WeChat account name, podcast show name. */
function sourceKeys(item: DiscoverSource) {
  const keys = [], name = nameKey(item.name);
  if (item.url) keys.push(`feed:${siteKey(feedUrl(item.url))}`); else keys.push(`id:${item.podcastId || item.id}`);
  const site = siteKey(item.site); if (name && site) keys.push(`site:${name}|${site}`);
  if (name && item.kind === 'wechat') keys.push(`wechat:${name}`);
  if (name) keys.push(`show:${name}`);
  return keys;
}
export function dedupeDiscovery(items: DiscoverSource[]) {
  const result = new Map<string, DiscoverSource>(), index = new Map<string, string>();
  for (const item of items) {
    let keys: string[]; try { keys = sourceKeys(item); } catch { continue; }
    // A show name only merges into a recommended podcast; plain blogs with equal names stay separate.
    const match = keys.map(key => index.get(key)).find((key, i) => key && (!keys[i].startsWith('show:') || result.get(key)?.podcastId));
    const previous = match && result.get(match);
    if (previous && match) {
      result.set(match, { ...previous, tags: [...new Set([...(previous.tags || []), ...(item.tags || [])])], provenance: previous.provenance.includes(item.provenance) ? previous.provenance : `${previous.provenance} · ${item.provenance}` });
      for (const key of keys) if (!index.has(key)) index.set(key, match);
      continue;
    }
    result.set(keys[0], item); for (const key of keys) if (!index.has(key)) index.set(key, keys[0]);
  }
  return [...result.values()];
}
export function searchDiscovery(items: DiscoverSource[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(f => words.every(w => `${f.name} ${f.description} ${f.url || ''} ${f.site || ''} ${f.group} ${(f.tags || []).join(' ')}`.toLocaleLowerCase().includes(w)))
    .sort((a, b) => Number(b.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) - Number(a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
}
