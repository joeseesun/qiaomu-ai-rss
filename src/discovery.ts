import { serviceUrl } from './model';
import blogCatalog from './data/independent-blogs.json';
export const blogCatalogSource = blogCatalog.source;
export const blogCatalogRevision = blogCatalog.revision;

export const DEFAULT_RSSHUB = 'https://rsshub.rssforever.com';
const BUILT_IN_FEED_URLS = new Set(['https://blog.qiaomu.ai/feed.xml']);
export const categories = ['全部', 'AI 与技术', '产品与工具', '人文与生活'] as const;
export type DiscoveryCollection = 'featured' | 'blogs' | 'rsshub';
export interface DiscoveryFeed {
  id: string;
  name: string;
  description: string;
  category: typeof categories[number] | '独立博客';
  language: '中文' | '英文';
  icon: string;
  url?: string;
  route?: string;
  site?: string;
  tags?: string[];
}

// Curated metadata only. Opening/searching the catalog never requests these feeds.
// Source provenance and live verification: docs/DISCOVERY.md.
export const discoveryFeeds: DiscoveryFeed[] = [
  { id: 'trend-weekly', name: '潮流周刊 · Tw93', description: '每周分享科技、产品、开源项目与生活灵感。', category: '产品与工具', language: '中文', icon: 'sparkles', url: 'https://weekly.tw93.fun/rss.xml', site: 'https://weekly.tw93.fun/' },
  { id: 'ruanyifeng', name: '阮一峰的网络日志', description: '科技爱好者周刊、开发教程与长期技术观察。', category: 'AI 与技术', language: '中文', icon: 'code-xml', url: 'https://www.ruanyifeng.com/blog/atom.xml', site: 'https://www.ruanyifeng.com/blog/' },
  { id: 'codingnow', name: '云风的 BLOG', description: '游戏开发、系统设计与工程实践的一手记录。', category: 'AI 与技术', language: '中文', icon: 'gamepad-2', url: 'https://blog.codingnow.com/atom.xml', site: 'https://blog.codingnow.com/' },
  { id: 'baoyu', name: '宝玉的分享', description: 'AI、软件工程与产品趋势的高密度解读和翻译。', category: 'AI 与技术', language: '中文', icon: 'bot', url: 'https://baoyu.io/feed.xml', site: 'https://baoyu.io/' },
  { id: 'hecaitou', name: '槽边往事 · 和菜头', description: '日常见闻、文化观察与个人经验写作。', category: '人文与生活', language: '中文', icon: 'feather', url: 'https://www.hecaitou.com/feeds/posts/default?alt=rss', site: 'https://www.hecaitou.com/' },
  { id: 'zhangxinxu', name: '张鑫旭的技术作品', description: '持续更新的 Web 前端技术研究、实验与写作。', category: 'AI 与技术', language: '中文', icon: 'braces', url: 'https://www.zhangxinxu.com/wordpress/feed/', site: 'https://www.zhangxinxu.com/' },
  { id: 'appinn', name: '小众软件', description: '发现实用、有趣、值得长期使用的软件与工具。', category: '产品与工具', language: '中文', icon: 'app-window', url: 'https://www.appinn.com/feed/', site: 'https://www.appinn.com/' },
  { id: 'williamlong', name: '月光博客', description: '互联网产品、网站技术与数字生活的长期记录。', category: 'AI 与技术', language: '中文', icon: 'moon', url: 'https://www.williamlong.info/rss.xml', site: 'https://www.williamlong.info/' },
  { id: 'reorx', name: 'Reorx’s Forge', description: '软件开发、生产力工具与数字生活的独立思考。', category: '产品与工具', language: '中文', icon: 'hammer', url: 'https://reorx.com/feed.xml', site: 'https://reorx.com/' },
  { id: 'pseudoyu', name: 'pseudoyu', description: '技术实践、个人成长与生活周报，完整记录思考过程。', category: '人文与生活', language: '中文', icon: 'notebook-pen', url: 'https://www.pseudoyu.com/zh/index.xml', site: 'https://www.pseudoyu.com/zh/' },
];
export const rsshubFeeds: DiscoveryFeed[] = [
  { id: 'github', name: 'GitHub 今日趋势', description: '发现今天受到开发者关注的开源项目。', category: 'AI 与技术', language: '英文', icon: 'git-fork', route: '/github/trending/daily/any' },
  { id: '36kr', name: '36氪快讯', description: '快速浏览商业、融资与科技公司的最新消息。', category: '产品与工具', language: '中文', icon: 'newspaper', route: '/36kr/newsflashes' },
];
export const independentBlogs: DiscoveryFeed[] = blogCatalog.items
  .filter(blog => !BUILT_IN_FEED_URLS.has(blog.url))
  .map(blog => ({ ...blog, description: blog.tags.join(' · ') || '中文独立博客', category: '独立博客', language: '中文', icon: 'notebook-pen' }));
export const blogTags = [...new Set(independentBlogs.flatMap(blog => blog.tags ?? []))].sort((a, b) => a.localeCompare(b, 'zh'));

export function discoveryUrl(feed: DiscoveryFeed, instance: string): string {
  if (feed.url) return feed.url;
  if (!feed.route?.startsWith('/') || feed.route.startsWith('//')) throw new Error('订阅路由无效。');
  return serviceUrl(instance) + feed.route;
}
export function filterDiscovery(query: string, category: string, collection: DiscoveryCollection = 'featured', tag = ''): DiscoveryFeed[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const source = collection === 'blogs' ? independentBlogs : collection === 'rsshub' ? rsshubFeeds : discoveryFeeds;
  return source.filter(feed => (collection === 'blogs' ? !tag || feed.tags?.includes(tag) : category === '全部' || feed.category === category)
    && terms.every(term => `${feed.name} ${feed.description} ${feed.category} ${feed.language} ${feed.route ? 'RSSHub' : 'RSS Atom'} ${feed.site ?? ''} ${feed.url ?? feed.route}`.toLocaleLowerCase().includes(term)));
}
