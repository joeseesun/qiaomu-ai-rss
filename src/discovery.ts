import { serviceUrl } from './model';
import blogCatalog from './data/independent-blogs.json';
export const blogCatalogSource = blogCatalog.source;
export const blogCatalogRevision = blogCatalog.revision;

export const DEFAULT_RSSHUB = 'https://rsshub.rssforever.com';
export const categories = ['全部', 'AI 与编程', '科技数码', '商业资讯', '科学探索'] as const;
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
  { id: 'qiaomu', name: '乔木博客', description: 'AI 工具实测、人物访谈与独立创作。', category: 'AI 与编程', language: '中文', icon: 'pen-line', url: 'https://blog.qiaomu.ai/feed.xml' },
  { id: 'simon', name: 'Simon Willison', description: '大模型、编程智能体与开发实践的一手观察。', category: 'AI 与编程', language: '英文', icon: 'code-xml', url: 'https://simonwillison.net/atom/everything/' },
  { id: 'github', name: 'GitHub 今日趋势', description: '发现今天受到开发者关注的开源项目。', category: 'AI 与编程', language: '英文', icon: 'git-fork', route: '/github/trending/daily/any' },
  { id: 'sspai', name: '少数派', description: '数字工具、效率方法与值得尝试的生活方式。', category: '科技数码', language: '中文', icon: 'smartphone', url: 'https://sspai.com/feed' },
  { id: 'ifanr', name: '爱范儿', description: '消费科技、新产品与设计背后的故事。', category: '科技数码', language: '中文', icon: 'tablet-smartphone', url: 'https://www.ifanr.com/feed' },
  { id: 'geekpark', name: '极客公园', description: '科技行业动态、创新产品与创业者。', category: '商业资讯', language: '中文', icon: 'lightbulb', url: 'https://www.geekpark.net/rss' },
  { id: '36kr', name: '36氪快讯', description: '快速浏览商业、融资与科技公司的最新消息。', category: '商业资讯', language: '中文', icon: 'newspaper', route: '/36kr/newsflashes' },
  { id: 'ithome', name: 'IT之家', description: '数码硬件、软件更新与科技新闻。', category: '科技数码', language: '中文', icon: 'monitor', url: 'https://www.ithome.com/rss/' },
  { id: 'hackernews', name: 'Hacker News', description: '技术社区首页热议的文章与项目。', category: 'AI 与编程', language: '英文', icon: 'messages-square', url: 'https://hnrss.org/frontpage' },
  { id: 'verge', name: 'The Verge', description: '科技如何影响文化、商业和日常生活。', category: '科技数码', language: '英文', icon: 'radio', url: 'https://www.theverge.com/rss/index.xml' },
  { id: 'quanta', name: 'Quanta Magazine', description: '数学、物理与生命科学的新发现，深入浅出。', category: '科学探索', language: '英文', icon: 'atom', url: 'https://www.quantamagazine.org/feed/' },
  { id: 'nasa', name: 'NASA', description: '太空任务、天文观测与航天研究进展。', category: '科学探索', language: '英文', icon: 'orbit', url: 'https://www.nasa.gov/feed/' },
];
export const independentBlogs: DiscoveryFeed[] = blogCatalog.items.map(blog => ({ ...blog, description: blog.tags.join(' · ') || '中文独立博客', category: '独立博客', language: '中文', icon: 'notebook-pen' }));
export const blogTags = [...new Set(independentBlogs.flatMap(blog => blog.tags ?? []))].sort((a, b) => a.localeCompare(b, 'zh'));

export function discoveryUrl(feed: DiscoveryFeed, instance: string): string {
  if (feed.url) return feed.url;
  if (!feed.route?.startsWith('/') || feed.route.startsWith('//')) throw new Error('订阅路由无效。');
  return serviceUrl(instance) + feed.route;
}
export function filterDiscovery(query: string, category: string, rsshubOnly: boolean, collection: 'featured' | 'blogs' = 'featured', tag = ''): DiscoveryFeed[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (collection === 'blogs' ? independentBlogs : discoveryFeeds).filter(feed => (collection === 'blogs' ? !tag || feed.tags?.includes(tag) : category === '全部' || feed.category === category)
    && (collection === 'blogs' || !rsshubOnly || !!feed.route)
    && terms.every(term => `${feed.name} ${feed.description} ${feed.category} ${feed.language} ${feed.route ? 'RSSHub' : 'RSS Atom'} ${feed.site ?? ''} ${feed.url ?? feed.route}`.toLocaleLowerCase().includes(term)));
}
