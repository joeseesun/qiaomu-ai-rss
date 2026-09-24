import { requestUrl } from 'obsidian';
import { z } from 'zod';

const wechatSchema = z.object({ total: z.number().int().nonnegative(), accounts: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{40}$/), name: z.string(), feedUrl: z.string() })) });
const podcastSearchSchema = z.object({ podcasts: z.array(z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string() })) });
export type CatalogFeed = { id: string; name: string; url: string; group: string };
export type PodcastSearchResult = { slug: string; name: string };

// Editorial order for the default catalog view. The API remains the source of
// truth for which accounts exist; search results keep their API order.
const featuredWechatIds = [
  'ff621c3e98d6ae6fceb3397e57441ffc6ea3c17f', // 数字生命卡兹克
  '6cef434b771dd75a91864b2e699a622cb4e3eb33', // AGENT橘
  '1c3e3571b1627d23ee9c64521a0b0a41d3fe2987', // 歸藏的AI工具箱
  '3e50f11753a7c5ed689565fbf5abf96cb4541c57', // 向阳乔木推荐看
  'c442206ec9957f3c52f2f40300ca532079538b31', // 晚点LatePost
  'e531a18b21c34cf787b83ab444eef659d7a980de', // 新智元
  '8d97af31b0de9e48da74558af128a4673d78c9a3', // 机器之心
  '752c31ca0446b837339463fc5440539e20267d2f', // 赛博禅心
  '1246d10fc107e600ae8897ec3dcb9be31cda79d7', // 葬AI
  'c68b58fb17ac7ae4b23c2af276cdd61c9eca1a48', // 36氪
];
const featuredWechatRank = new Map(featuredWechatIds.map((id, index) => [`wechat-${id}`, index]));

async function catalogJson(url: string): Promise<unknown> {
  let timer: number | undefined;
  const response = await Promise.race([requestUrl({ url, method: 'GET', throw: false }), new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('目录请求超时。')), 20000); })]).finally(() => window.clearTimeout(timer));
  if (response.status < 200 || response.status >= 300) throw new Error(`目录暂不可用（HTTP ${response.status}）。`);
  if (response.text.length > 2_000_000) throw new Error('目录数据过大。');
  return JSON.parse(response.text) as unknown;
}

export async function searchWechat(base: string, query: string): Promise<{ total: number; feeds: CatalogFeed[] }> {
  const data = wechatSchema.parse(await catalogJson(`${base}/api/wechat/catalog?q=${encodeURIComponent(query.slice(0, 100))}`));
  const feeds = data.accounts.filter(item => item.feedUrl === `https://wechat2rss.bestblogs.dev/feed/${item.id}.xml`)
    .map(item => ({ id: `wechat-${item.id}`, name: item.name, url: item.feedUrl, group: '微信公众号' }));
  if (!query.trim()) feeds.sort((a, b) => (featuredWechatRank.get(a.id) ?? Infinity) - (featuredWechatRank.get(b.id) ?? Infinity));
  return { total: data.total, feeds };
}
export async function searchPodcasts(base: string, query: string): Promise<PodcastSearchResult[]> {
  if (!query.trim()) return [];
  const data = podcastSearchSchema.parse(await catalogJson(`${base}/api/podscribe/search?q=${encodeURIComponent(query.trim().slice(0, 100))}`));
  return data.podcasts.slice(0, 30);
}
