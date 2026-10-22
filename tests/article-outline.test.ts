// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArticleOutline, articleHeadings } from '../src/article-outline';
import { articleFragment } from '../src/content';
import type { Bundle } from '../src/model';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const bundle: Bundle = { entry: { id: 'outline', sourceId: 'test', title: 'Article' }, rewrite: null, translation: null, fetchedAt: 1 };

describe('rendered article outline', () => {
  it('keeps real heading order and duplicate titles, normalizes skipped levels, ignores bold paragraphs and empty headings', () => {
    const prose = document.createElement('div');
    prose.innerHTML = '<h2>Part <em>one</em></h2><h4>Detail</h4><h3>Detail</h3><p><strong>Not a heading</strong></p><h2>Part one</h2><h6>  </h6><div hidden><h3>Hidden</h3></div>';
    const items = articleHeadings(prose);
    expect(items.map(({ text, depth }) => [text, depth])).toEqual([['Part one', 0], ['Detail', 1], ['Detail', 1], ['Part one', 0]]);
    expect(items[0].element).not.toBe(items[3].element);
  });
  it('preserves heading structure in translated plain text without trusting its HTML', () => {
    const value: Bundle = { ...bundle, translation: { content: [
      { target: '中文章节<script>text</script>', sourceHtml: ' <h2 onclick="evil()">Chapter</h2>\n', targetHtml: '<p>outdated</p>' },
      { target: '小节', targetHtml: '<h4>old title</h4>' },
      { target: '正文', sourceHtml: '<p><strong>Bold</strong></p>' },
      { target: '保留段落', sourceHtml: '<h2>One</h2><p>Other</p>' },
      { targetHtml: '<h3>HTML only</h3><script>evil()</script>' },
    ] } };
    const fragment = articleFragment(value, 'translation', document, false)!;
    const prose = document.createElement('div'); prose.append(fragment);
    expect(articleHeadings(prose).map(({ text, depth }) => [text, depth])).toEqual([['中文章节<script>text</script>', 0], ['小节', 1], ['HTML only', 1]]);
    expect(prose.querySelector('script,[onclick]')).toBeNull();
    expect(prose.querySelectorAll('p')).toHaveLength(2);
  });
  it('extracts original and rewritten headings without mutating their content', () => {
    const value = { ...bundle, entry: { ...bundle.entry, content: '<h2>原文</h2><p>正文</p>' }, rewrite: { body: '## 改写\n\n### 小节\n\n正文' } };
    for (const [mode, expected] of [['original', ['原文']], ['rewrite', ['改写', '小节']]] as const) {
      const prose = document.createElement('div'); prose.append(articleFragment(value, mode, document, false)!);
      const html = prose.innerHTML;
      expect(articleHeadings(prose).map(item => item.text)).toEqual(expected);
      expect(prose.innerHTML).toBe(html);
    }
  });
});

function fixture() {
  let frame: FrameRequestCallback | undefined;
  const raf = vi.fn((fn: FrameRequestCallback) => { frame = fn; return 1; });
  const cancel = vi.fn(() => { frame = undefined; });
  vi.stubGlobal('requestAnimationFrame', raf); vi.stubGlobal('cancelAnimationFrame', cancel);
  let resized: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { resized = fn; } observe() {} disconnect = disconnect; });
  const scroller = document.createElement('div');
  scroller.innerHTML = '<div class="qrs-reader-head"></div><article class="qrs-article"><div class="qrs-prose"><h2>Same</h2><p>Body</p><h2>Same</h2><h3>End</h3></div></article>';
  document.body.append(scroller);
  Object.defineProperties(scroller, { scrollHeight: { value: 1400 }, clientHeight: { value: 400 } });
  scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  scroller.querySelector<HTMLElement>('.qrs-reader-head')!.getBoundingClientRect = () => ({ height: 44 }) as DOMRect;
  const positions = [200, 600, 1200];
  const measurements = [...scroller.querySelectorAll<HTMLElement>('h2,h3')].map((h, index) => vi.spyOn(h, 'getBoundingClientRect').mockImplementation(() => ({ top: 100 + positions[index] - scroller.scrollTop }) as DOMRect));
  scroller.scrollTo = vi.fn(options => { scroller.scrollTop = (options as ScrollToOptions).top!; scroller.dispatchEvent(new Event('scroll')); });
  const beforeJump = vi.fn(), selected = vi.fn();
  const outline = new ArticleOutline({ title: 'Article', loading: false, prose: scroller.querySelector('.qrs-prose'), scroller, beforeJump }, selected);
  const flush = () => { const fn = frame; frame = undefined; fn?.(0); };
  return { outline, scroller, beforeJump, selected, flush, measurements, positions, disconnect, raf, resize: () => resized?.() };
}

describe('outline navigation and lifecycle', () => {
  it('jumps to the exact duplicate heading below the toolbar and follows scrolling without remeasuring each frame', () => {
    const f = fixture(); f.flush();
    expect(f.selected).toHaveBeenLastCalledWith(0);
    f.outline.jump(1);
    expect(f.beforeJump).toHaveBeenCalledOnce();
    expect(f.scroller.scrollTop).toBe(540);
    expect(f.selected).toHaveBeenLastCalledWith(1);
    const reads = f.measurements[0].mock.calls.length;
    f.scroller.scrollTop = 200; f.scroller.dispatchEvent(new Event('scroll')); f.flush();
    expect(f.selected).toHaveBeenLastCalledWith(0);
    expect(f.measurements[0]).toHaveBeenCalledTimes(reads);
    f.outline.dispose();
  });
  it('remeasures after images or fonts change layout and selects the last section at the bottom', () => {
    const f = fixture(); f.flush();
    f.positions[1] = 800; f.resize(); f.flush(); f.outline.jump(1);
    expect(f.scroller.scrollTop).toBe(740);
    f.scroller.scrollTop = 1000; f.scroller.dispatchEvent(new Event('scroll')); f.flush();
    expect(f.selected).toHaveBeenLastCalledWith(2);
    f.outline.dispose();
  });
  it('removes observers, queued frames and scroll listeners when replaced or closed', () => {
    const f = fixture(); f.flush(); f.outline.dispose();
    const calls = f.raf.mock.calls.length;
    f.scroller.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')); f.flush();
    expect(f.raf).toHaveBeenCalledTimes(calls);
    expect(f.disconnect).toHaveBeenCalledOnce();
  });
});
