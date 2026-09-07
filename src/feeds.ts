import createDOMPurify from 'dompurify';
import { safeUrl, type Entry, type Subscription } from './model';

export const MAX_SUBSCRIPTIONS = 100;
const MAX_XML = 5 * 1024 * 1024;
const MAX_STORED_FEED = 1024 * 1024;
export interface FeedInput { url: string; name: string; group: string }
export function feedUrl(value: string): string {
  const safe = safeUrl(value.trim());
  if (!safe) throw new Error('请输入完整的 HTTP 或 HTTPS 订阅地址，不包含账号密码。');
  const url = new URL(safe); url.hash = ''; return url.href;
}
export async function stableId(value: string): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function xmlDocument(value: string, doc: Document): Document {
  if (new TextEncoder().encode(value).byteLength > MAX_XML) throw new Error('文件超过 5 MB，请使用较小的订阅文件。');
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('不支持包含 DTD 或实体声明的订阅文件。');
  const win = doc.defaultView;
  if (!win) throw new Error('阅读窗口不可用。');
  const parsed = new win.DOMParser().parseFromString(value, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('XML 格式无效，请检查订阅地址或文件。');
  return parsed;
}
function children(node: Element, name: string): Element[] { return Array.from(node.children).filter(child => child.localName === name); }
function child(node: Element, name: string): Element | undefined { return children(node, name)[0]; }
function text(node: Element, name: string): string { return child(node, name)?.textContent?.trim() || ''; }
function baseUrl(node: Element, fallback: string): string {
  const chain: Element[] = []; let current: Element | null = node;
  while (current) { chain.unshift(current); current = current.parentElement; }
  return chain.reduce((base, el) => safeUrl(el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'base') || '', base) || base, fallback);
}
function hasXmlBase(node: Element): boolean {
  let current: Element | null = node;
  while (current) { if (current.hasAttributeNS('http://www.w3.org/XML/1998/namespace', 'base')) return true; current = current.parentElement; }
  return false;
}
function escapeXml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function plain(value: string, doc: Document): string {
  return createDOMPurify(doc.defaultView!).sanitize(value, { RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: [] }).textContent?.trim() || '';
}
function atomContent(node?: Element): string {
  if (!node) return '';
  if (node.getAttribute('type') === 'xhtml') return Array.from(node.children).map(el => el.outerHTML).join('');
  const value = node.textContent || '';
  return node.getAttribute('type') === 'html' ? value : `<p>${escapeXml(value)}</p>`;
}
function contentWithBase(html: string, base: string, doc: Document): { html: string; image?: string } {
  // Parsing into an inert sanitized fragment also prevents source HTML from making requests.
  const fragment = createDOMPurify(doc.defaultView!).sanitize(html, { RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['xml:base'], FORBID_TAGS: ['style', 'iframe'] });
  for (const el of fragment.querySelectorAll('[href],[src]')) {
    for (const attr of ['href', 'src']) {
      const raw = el.getAttribute(attr); if (!raw) continue;
      const url = safeUrl(raw, baseUrl(el, base));
      if (url) el.setAttribute(attr, url); else el.removeAttribute(attr);
    }
  }
  const image = fragment.querySelector('img[src]')?.getAttribute('src') || undefined;
  return { html: Array.from(fragment.childNodes).map(node => node.nodeType === 1 ? (node as Element).outerHTML : escapeXml(node.textContent || '')).join(''), image };
}
function entryImage(item: Element, contentImage: string | undefined, base: string): string | undefined {
  for (const node of Array.from(item.getElementsByTagName('*'))) {
    const name = node.localName.toLocaleLowerCase();
    const type = node.getAttribute('type') || '';
    const isImage = name === 'thumbnail' ||
      (name === 'content' && (node.getAttribute('medium') === 'image' || type.startsWith('image/'))) ||
      (name === 'enclosure' && type.startsWith('image/')) ||
      (name === 'link' && node.getAttribute('rel') === 'enclosure' && type.startsWith('image/'));
    if (!isImage) continue;
    const raw = node.getAttribute('url') || node.getAttribute('href');
    const resolved = raw ? safeUrl(raw, baseUrl(node, base)) : null;
    if (resolved) return resolved;
  }
  return contentImage ? safeUrl(contentImage, base) || undefined : undefined;
}
export async function parseFeed(xml: string, url: string, doc: Document): Promise<{ name: string; entries: Entry[] }> {
  const root = xmlDocument(xml, doc).documentElement;
  const atom = root.localName === 'feed' && root.namespaceURI === 'http://www.w3.org/2005/Atom';
  const channel = child(root, 'channel');
  if (!atom && !(['rss', 'RDF'].includes(root.localName) && channel)) throw new Error('这个地址不是 RSS 或 Atom 订阅源，请填写订阅文件地址。');
  const parent = atom ? root : channel!;
  const name = plain(text(parent, 'title'), doc).slice(0, 200) || new URL(url).hostname;
  const sourceId = `local:${await stableId(url)}`;
  const items = atom ? children(root, 'entry') : children(root.localName === 'RDF' ? root : parent, 'item');
  const entries: Entry[] = []; const ids = new Set<string>(); let size = 0;
  for (const item of items.slice(0, 200)) {
    const linkNode = atom ? children(item, 'link').find(el => !el.getAttribute('rel') || el.getAttribute('rel') === 'alternate') : child(item, 'link');
    const linkValue = atom ? linkNode?.getAttribute('href') : linkNode?.textContent;
    const base = baseUrl(item, url);
    const link = linkValue ? safeUrl(linkValue.trim(), linkNode ? baseUrl(linkNode, base) : base) : null;
    const contentNode = atom ? child(item, 'content') || child(item, 'summary') : child(item, 'encoded') || child(item, 'description');
    const raw = atom ? atomContent(contentNode) : contentNode?.textContent || '';
    const title = plain(atom ? atomContent(child(item, 'title')) : text(item, 'title'), doc).slice(0, 300) || plain(raw, doc).slice(0, 80) || '未命名文章';
    const published = (atom ? text(item, 'published') || text(item, 'updated') : text(item, 'pubDate') || text(item, 'date')) || '';
    const identity = (atom ? text(item, 'id') : text(item, 'guid')) || link || `${title}\n${published}`;
    const id = `local-${await stableId(`${sourceId}\n${identity}`)}`;
    if (ids.has(id)) continue; ids.add(id);
    const publishedTs = Date.parse(published);
    const contentBase = contentNode && hasXmlBase(contentNode) ? baseUrl(contentNode, url) : link || base;
    const parsedContent = contentWithBase(raw.slice(0, 100_000), contentBase, doc);
    const entry: Entry = { id, sourceId, origin: 'local', sourceName: name, title, link: link || url, image: entryImage(item, parsedContent.image, contentBase),
      published, publishedTs: Number.isNaN(publishedTs) ? null : publishedTs,
      author: atom ? text(child(item, 'author') || root, 'name') : text(item, 'creator') || text(item, 'author'),
      summary: plain(raw, doc).slice(0, 240), content: (parsedContent.html || '<p>订阅源没有提供正文，请打开原文阅读。</p>') + (raw.length > 100_000 ? '<p>正文较长，已缓存部分内容。请打开原文阅读全文。</p>' : '') };
    size += new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    if (size > MAX_STORED_FEED) break;
    entries.push(entry);
    if (entries.length === 50) break;
  }
  entries.sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0));
  return { name, entries };
}
export function parseOpml(xml: string, doc: Document): { feeds: FeedInput[]; skipped: number } {
  const root = xmlDocument(xml, doc).documentElement;
  if (root.localName !== 'opml' || !child(root, 'body')) throw new Error('请选择有效的 OPML 订阅文件。');
  const feeds: FeedInput[] = []; const seen = new Set<string>(); let skipped = 0;
  for (const node of Array.from(root.getElementsByTagName('outline'))) {
    const raw = node.getAttribute('xmlUrl') || node.getAttribute('xmlurl'); if (!raw) continue;
    try {
      const url = feedUrl(raw);
      if (seen.has(url)) { skipped++; continue; } seen.add(url);
      const groups: string[] = []; let parent = node.parentElement;
      while (parent?.localName === 'outline') { const label = parent.getAttribute('text') || parent.getAttribute('title'); if (label) groups.unshift(label); parent = parent.parentElement; }
      feeds.push({ url, name: (node.getAttribute('title') || node.getAttribute('text') || new URL(url).hostname).slice(0, 200), group: groups.join(' / ').slice(0, 100) });
    } catch { skipped++; }
  }
  if (!feeds.length) throw new Error('文件中没有有效的 HTTP / HTTPS 订阅地址。');
  return { feeds, skipped };
}
export function exportOpml(feeds: Pick<Subscription, 'url' | 'name' | 'group'>[]): string {
  const groups = new Map<string, typeof feeds>();
  for (const feed of feeds) { const group = groups.get(feed.group) || []; group.push(feed); groups.set(feed.group, group); }
  const outline = (feed: typeof feeds[number]) => `<outline type="rss" text="${escapeXml(feed.name)}" title="${escapeXml(feed.name)}" xmlUrl="${escapeXml(feed.url)}"/>`;
  const body = Array.from(groups, ([group, values]) => group ? `<outline text="${escapeXml(group)}">\n${values.map(outline).join('\n')}\n</outline>` : values.map(outline).join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Qiaomu AI RSS subscriptions</title></head><body>\n${body}\n</body></opml>\n`;
}
