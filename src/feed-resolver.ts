import createDOMPurify from 'dompurify';
import { feedUrl, parseFeed, parseOpml, xmlDocument } from './feeds';
import { readImportUrl, type ImportDocument } from './import-source';
import { fail } from './i18n';
import { safeUrl } from './model';

export type ResolvedFeed = { kind: 'feed'; url: string; parsed: Awaited<ReturnType<typeof parseFeed>>; etag?: string; lastModified?: string };
export type SourceResult = ResolvedFeed | { kind: 'opml'; feeds: ReturnType<typeof parseOpml>['feeds']; skipped: number } | { kind: 'candidates'; feeds: ResolvedFeed[]; failed: number };
export function isSourceInput(value: string) { return /^(?:[a-z][\w+.-]*:\/\/|www\.|[^\s/]+\.[a-z]{2,}(?:[/:?#]|$)|<)/i.test(value.trim()); }
export function sourceUrl(value: string) { return feedUrl(/^[a-z][\w+.-]*:/i.test(value.trim()) ? value : `https://${value.trim()}`); }

/** Content determines the format, including OPML served under a .xml URL. */
export async function resolveDocument(text: string, url: string | undefined, doc: Document): Promise<ResolvedFeed | Extract<SourceResult, { kind: 'opml' }>> {
  const root = xmlDocument(text, doc).documentElement;
  if (root.localName === 'opml') return { kind: 'opml', ...parseOpml(text, doc) };
  if (!['rss', 'feed', 'RDF'].includes(root.localName)) fail('source.unsupported');
  if (!url) {
    // A downloaded feed needs a canonical online feed address to keep updating.
    const self = Array.from(root.getElementsByTagNameNS('http://www.w3.org/2005/Atom', 'link')).find(el => el.getAttribute('rel') === 'self');
    const address = self?.getAttribute('href');
    if (!address || !safeUrl(address)) fail('source.needOnlineUrl');
    url = feedUrl(address);
  }
  return { kind: 'feed', url, parsed: await parseFeed(text, url, doc) };
}

/** Only declarative HTML head links; never crawl body links or guess endpoints. */
export function discoverFeedUrls(text: string, doc: Document, finalUrl?: string): string[] {
  const html = createDOMPurify(doc.defaultView!).sanitize(text, { WHOLE_DOCUMENT: true, RETURN_DOM: true, ALLOWED_TAGS: ['html', 'head', 'link', 'base'], ALLOWED_ATTR: ['rel', 'href', 'type'] }) as HTMLElement;
  const declared = html.querySelector('head base[href]')?.getAttribute('href') || '';
  const base = safeUrl(declared, finalUrl) || finalUrl;
  const urls = new Set<string>();
  for (const link of html.querySelectorAll('head link[href]')) {
    if (!link.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('alternate')) continue;
    if (!['application/rss+xml', 'application/atom+xml', 'application/rdf+xml'].includes((link.getAttribute('type') || '').toLowerCase().split(';')[0].trim())) continue;
    const url = safeUrl(link.getAttribute('href') || '', base);
    if (url) urls.add(feedUrl(url));
    if (urls.size === 8) break;
  }
  return [...urls];
}
export async function resolveSource(raw: string, doc: Document, current: () => boolean = () => true, read = readImportUrl): Promise<SourceResult> {
  const deadline = Date.now() + 30000;
  const load = (url: string) => read(url, current, Math.max(1, deadline - Date.now()));
  const result = await load(sourceUrl(raw));
  if (!current()) fail('source.cancelled');
  const isHtml = /^\s*(?:<!doctype\s+html\b|<html\b|<head\b)/i.test(result.text);
  if (!isHtml) return withValidators(await resolveDocument(result.text, result.url, doc), result);
  const candidates = discoverFeedUrls(result.text, doc, result.finalUrl);
  if (!candidates.length) fail('source.noFeed');
  const found: ResolvedFeed[] = []; let failed = 0;
  const remaining = [...candidates];
  await Promise.all(Array.from({ length: Math.min(3, remaining.length) }, async () => {
    while (remaining.length && current()) {
      const url = remaining.shift()!;
      try {
        const response = await load(url), parsed = await resolveDocument(response.text, response.url, doc);
        if (parsed.kind !== 'feed') { failed++; continue; }
        found.push(withValidators(parsed, response));
      } catch { failed++; }
    }
  }));
  if (!current()) fail('source.cancelled');
  if (!found.length) fail('source.noFeed');
  return found.length === 1 && !failed ? found[0] : { kind: 'candidates', feeds: found, failed };
}
function withValidators<T extends Awaited<ReturnType<typeof resolveDocument>>>(source: T, response: ImportDocument): T {
  if (source.kind === 'feed') {
    source.etag = response.headers?.etag; source.lastModified = response.headers?.['last-modified'];
  }
  return source;
}
