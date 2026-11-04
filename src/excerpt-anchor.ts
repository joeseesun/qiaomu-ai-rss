import type { OutlineContext } from './article-outline';

export interface TextQuoteSelector { type: 'TextQuoteSelector'; exact: string; prefix?: string; suffix?: string }

function normalize(raw: string) {
  let text = '', space = false;
  const source: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) { space = true; continue; }
    if (space && text) { text += ' '; source.push(i - 1); }
    space = false; text += raw[i]; source.push(i);
  }
  return { text, source };
}

function textIndex(prose: HTMLElement) {
  const nodes: Array<{ node: Text; start: number; group: number }> = [];
  const walker = prose.ownerDocument.createTreeWalker(prose, 4);
  let raw = '', previous: Element | null = null, node: Node | null, group = 0;
  while ((node = walker.nextNode())) {
    if (!node.textContent || node.parentElement?.closest('script,style,[hidden],[aria-hidden="true"]')) continue;
    const block = node.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,div') ?? prose;
    if (previous && previous !== block) { raw += '\n'; group++; }
    nodes.push({ node: node as Text, start: raw.length, group });
    raw += node.textContent; previous = block;
  }
  return { ...normalize(raw), nodes };
}

export function captureTextFragment(prose: HTMLElement | null | undefined, range: Range | undefined): string | undefined {
  if (!prose || !range || range.collapsed || !prose.contains(range.startContainer) || !prose.contains(range.endContainer)) return;
  const groups: Array<{ text: string; from: number; to: number }> = [];
  for (const { node, group } of textIndex(prose).nodes) {
    const block = groups[group] ??= { text: '', from: Infinity, to: -1 };
    if (range.intersectsNode(node)) {
      const from = range.startContainer === node ? range.startOffset : 0;
      const to = range.endContainer === node ? range.endOffset : node.length;
      if (from < to) { block.from = Math.min(block.from, block.text.length + from); block.to = Math.max(block.to, block.text.length + to); }
    }
    block.text += node.data;
  }
  const selected = groups.filter(block => block.from < block.to && normalize(block.text.slice(block.from, block.to)).text);
  const first = selected[0], last = selected.at(-1);
  if (!first || !last) return;
  const encode = (text: string) => encodeURIComponent(text).replace(/-/g, '%2D');
  const parts = [encode(normalize(first.text.slice(first.from, first.to)).text)];
  if (selected.length > 1) parts.push(encode(normalize(last.text.slice(last.from, last.to)).text));
  const prefix = Array.from(normalize(first.text.slice(0, first.from)).text).slice(-32).join('');
  const suffix = Array.from(normalize(last.text.slice(last.to)).text).slice(0, 32).join('');
  if (prefix) parts.unshift(encode(prefix) + '-');
  if (suffix) parts.push('-' + encode(suffix));
  return 'text=' + parts.join(',');
}

export function captureTextQuote(prose: HTMLElement | null | undefined, range: Range | undefined): TextQuoteSelector | undefined {
  if (!prose || !range || range.collapsed || !prose.contains(range.startContainer) || !prose.contains(range.endContainer)) return;
  const index = textIndex(prose);
  let from = Infinity, to = -1;
  for (const { node, start } of index.nodes) {
    if (!range.intersectsNode(node)) continue;
    const a = range.startContainer === node ? range.startOffset : 0;
    const b = range.endContainer === node ? range.endOffset : node.length;
    if (a < b) { from = Math.min(from, start + a); to = Math.max(to, start + b); }
  }
  let start = index.source.findIndex(offset => offset >= from);
  let end = index.source.findIndex(offset => offset >= to);
  if (end < 0) end = index.text.length;
  while (start >= 0 && start < end && /\s/.test(index.text[start])) start++;
  while (end > start && /\s/.test(index.text[end - 1])) end--;
  if (start < 0 || start >= end) return;
  return { type: 'TextQuoteSelector', exact: index.text.slice(start, end), prefix: index.text.slice(Math.max(0, start - 32), start), suffix: index.text.slice(end, end + 32) };
}

export function parseTextQuote(value: string): TextQuoteSelector | undefined {
  try {
    const quote: unknown = JSON.parse(value);
    if (!quote || typeof quote !== 'object' || !('type' in quote) || quote.type !== 'TextQuoteSelector' || !('exact' in quote) || typeof quote.exact !== 'string' || !quote.exact.trim()) return;
    const prefix = 'prefix' in quote ? quote.prefix : undefined, suffix = 'suffix' in quote ? quote.suffix : undefined;
    if (prefix !== undefined && typeof prefix !== 'string' || suffix !== undefined && typeof suffix !== 'string') return;
    return { type: 'TextQuoteSelector', exact: quote.exact, prefix, suffix };
  } catch { return; }
}

export function resolveTextQuote(prose: HTMLElement, quote: TextQuoteSelector): Range | undefined {
  const index = textIndex(prose), exact = normalize(quote.exact).text;
  if (!exact) return;
  let found = -1;
  for (let at = index.text.indexOf(exact); at >= 0; at = index.text.indexOf(exact, at + 1)) {
    if (quote.prefix && !index.text.slice(0, at).endsWith(quote.prefix) || quote.suffix && !index.text.slice(at + exact.length).startsWith(quote.suffix)) continue;
    if (found >= 0) return;
    found = at;
  }
  if (found < 0) return;
  const from = index.source[found], to = index.source[found + exact.length - 1];
  const a = index.nodes.find(part => from >= part.start && from < part.start + part.node.length);
  const b = index.nodes.find(part => to >= part.start && to < part.start + part.node.length);
  if (!a || !b) return;
  const range = prose.ownerDocument.createRange();
  range.setStart(a.node, from - a.start); range.setEnd(b.node, to - b.start + 1);
  return range;
}

export function highlightTextQuote(context: OutlineContext | null, quote: TextQuoteSelector): boolean {
  if (!context?.prose) return false;
  const range = resolveTextQuote(context.prose, quote), win = context.prose.ownerDocument.defaultView;
  if (!range || !win?.CSS?.highlights || typeof win.Highlight !== 'function') return false;
  context.beforeJump();
  win.CSS.highlights.set('qrs-excerpt-target', new win.Highlight(range));
  const { scroller } = context;
  const inset = (scroller.querySelector('.qrs-reader-head')?.getBoundingClientRect().height || 0) + 16;
  const top = scroller.scrollTop + range.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop - inset;
  scroller.scrollTo({ top: Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight)), behavior: 'instant' });
  return true;
}
