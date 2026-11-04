// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureTextFragment, captureTextQuote, highlightTextQuote, parseTextQuote, resolveTextQuote } from '../src/excerpt-anchor';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function prose(html: string) { const el = document.createElement('article'); el.innerHTML = html; document.body.append(el); return el; }
function select(el: Element) { const range = document.createRange(); range.selectNodeContents(el); return range; }

describe('text quote capture and resolution', () => {
  it('builds browser fragments with block-local context and escaped directive delimiters', () => {
    const el = prose('<h2>Heading must not enter the prefix</h2><p>Before <b>中文, A-B + 😀</b> after</p><p>Other block</p>');
    const encode = (text: string) => encodeURIComponent(text).replace(/-/g, '%2D');
    expect(captureTextFragment(el, select(el.querySelector('b')!))).toBe('text=Before-,' + encode('中文, A-B + 😀') + ',-after');
  });
  it('uses separate start and end strings when the selection spans blocks', () => {
    const el = prose('<p>Before <b>First part</b></p><p>Middle paragraph</p><p><i>Last part</i> after</p>');
    const range = document.createRange(); range.setStart(el.querySelector('b')!.firstChild!, 0); range.setEnd(el.querySelector('i')!.firstChild!, 9);
    expect(captureTextFragment(el, range)).toBe('text=Before-,First%20part,Last%20part,-after');
  });
  it('does not create fragments for collapsed, blank or out-of-article selections', () => {
    const el = prose('<p>   </p>'), outside = prose('<p>Other</p>');
    expect(captureTextFragment(el, select(el))).toBeUndefined();
    expect(captureTextFragment(el, select(outside))).toBeUndefined();
    expect(captureTextFragment(el, document.createRange())).toBeUndefined();
    expect(captureTextFragment(null, undefined)).toBeUndefined();
  });
  it('round trips Chinese, emoji, inline markup and normalized whitespace', () => {
    const el = prose('<h2>章节</h2><p>之前 <span>测试<strong>文字</strong> 😀\n 中文</span> 之后</p>');
    const original = select(el.querySelector('span')!);
    const quote = captureTextQuote(el, original)!;
    expect(quote).toMatchObject({ type: 'TextQuoteSelector', exact: '测试文字 😀 中文' });
    expect(quote.prefix).toBe('章节 之前 '); expect(quote.suffix).toBe(' 之后');
    expect(resolveTextQuote(el, quote)?.toString()).toBe(original.toString());
    expect(parseTextQuote(JSON.stringify(quote))).toEqual(quote);
  });
  it('handles selections spanning paragraphs and element-offset boundaries', () => {
    const el = prose('<p>First</p><p>Second</p><p>Third</p>');
    const range = document.createRange(); range.setStart(el, 0); range.setEnd(el, 2);
    const quote = captureTextQuote(el, range)!;
    expect(quote.exact).toBe('First Second');
    expect(resolveTextQuote(el, quote)?.toString()).toBe('FirstSecond');
    expect(quote.suffix).toBe(' Third');
  });
  it('uses surrounding text to disambiguate repetitions and refuses unresolved ambiguity', () => {
    const el = prose('<p>Before A <b>same</b> after A.</p><p>Before B <b>same</b> after B.</p>');
    const quote = captureTextQuote(el, select(el.querySelectorAll('b')[1]))!;
    expect(resolveTextQuote(el, quote)?.startContainer).toBe(el.querySelectorAll('b')[1].firstChild);
    expect(resolveTextQuote(el, { type: 'TextQuoteSelector', exact: 'same' })).toBeUndefined();
    expect(resolveTextQuote(el, { ...quote, exact: 'removed' })).toBeUndefined();
    expect(resolveTextQuote(el, { ...quote, prefix: 'changed context' })).toBeUndefined();
  });
  it('ignores hidden and script text and survives changes to inline formatting', () => {
    const el = prose('<p>Before <span>target</span> after</p><p hidden>target</p><script>target</script>');
    const quote = captureTextQuote(el, select(el.querySelector('span')!))!;
    el.innerHTML = '<p>Before <em>tar</em><b>get</b> after</p><div aria-hidden="true">target</div>';
    expect(resolveTextQuote(el, quote)?.toString()).toBe('target');
  });
  it('rejects empty, collapsed and out-of-article selections', () => {
    const el = prose('<p>Body</p>'), other = prose('<p>Other</p>');
    expect(captureTextQuote(el, document.createRange())).toBeUndefined();
    expect(captureTextQuote(el, select(other))).toBeUndefined();
    expect(captureTextQuote(null, select(el))).toBeUndefined();
    expect(captureTextQuote(el, undefined)).toBeUndefined();
    const blank = prose('<p>   </p>');
    expect(captureTextQuote(blank, select(blank))).toBeUndefined();
  });
  it.each(['invalid', 'null', '[]', '{"type":"Other","exact":"Body"}', '{"type":"TextQuoteSelector","exact":" "}', '{"type":"TextQuoteSelector","exact":"Body","prefix":3}'])('rejects malformed URL selectors: %s', value => {
    expect(parseTextQuote(value)).toBeUndefined();
  });
});

describe('excerpt highlighting', () => {
  it('highlights a unique range without modifying article HTML and scrolls only the reader', () => {
    const el = prose('<p>Before <b>target</b> after</p>'), html = el.innerHTML;
    const quote = captureTextQuote(el, select(el.querySelector('b')!))!;
    const highlights = new Map();
    vi.stubGlobal('CSS', { highlights });
    vi.stubGlobal('Highlight', class { constructor(public range: Range) {} });
    Object.assign(Range.prototype, { getBoundingClientRect: () => ({ top: 300 }) });
    el.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    Object.defineProperties(el, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 } });
    el.scrollTo = vi.fn(); const beforeJump = vi.fn();
    expect(highlightTextQuote({ title: 'Article', loading: false, prose: el, scroller: el, beforeJump }, quote)).toBe(true);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 184, behavior: 'instant' });
    expect(highlights.get('qrs-excerpt-target').range.toString()).toBe('target');
    expect(beforeJump).toHaveBeenCalledOnce(); expect(el.innerHTML).toBe(html);
  });
  it('returns failure for missing or ambiguous text and unsupported highlight environments', () => {
    const el = prose('<p>Body Body</p>'), beforeJump = vi.fn();
    const context = { title: 'Article', loading: false, prose: el, scroller: el, beforeJump };
    expect(highlightTextQuote(context, { type: 'TextQuoteSelector', exact: 'Body' })).toBe(false);
    expect(highlightTextQuote(context, { type: 'TextQuoteSelector', exact: 'Body Body' })).toBe(false);
    expect(highlightTextQuote(null, { type: 'TextQuoteSelector', exact: 'Body' })).toBe(false);
    expect(beforeJump).not.toHaveBeenCalled();
  });
});
