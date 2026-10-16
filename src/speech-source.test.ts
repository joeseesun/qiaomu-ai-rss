// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { articleSpeechSource, sameSpeechRange } from './speech-source';
describe('rendered article speech', () => {
  it('reads rendered prose only, keeps paragraph owners and skips code and pronunciation', () => {
    const document = new DOMParser().parseFromString('<div id="prose"><p>原文第一句。<em>第二句。</em><code>secret code</code></p><pre>code block</pre><p>汉<ruby>字<rt>zi</rt></ruby>。</p><div aria-hidden="true">hidden</div></div>', 'text/html');
    const root = document.querySelector<HTMLElement>('#prose')!;
    const source = articleSpeechSource(root, 240, false);
    expect(source.items.map(item => item.text).join('')).toBe('原文第一句。第二句。汉字。');
    expect(source.items[0].block.tagName).toBe('P');
    expect(source.items.at(-1)?.start).toBeGreaterThan(source.items[0].end);
  });
  it('fingerprint is independent of provider chunk size and changes with displayed content', () => {
    const document = new DOMParser().parseFromString('<div><p>相同正文第一句。相同正文第二句。第三句。</p></div>', 'text/html');
    const root = document.querySelector('div')!;
    const online = articleSpeechSource(root, 240, false), local = articleSpeechSource(root, 5, true);
    expect(online.fingerprint).toBe(local.fingerprint);
    root.querySelector('p')!.textContent = '翻译后的正文。';
    expect(articleSpeechSource(root, 240, false).fingerprint).not.toBe(online.fingerprint);
  });
  it('maps spoken character positions back to DOM text across inline markup and whitespace', () => {
    const document = new DOMParser().parseFromString('<div><p>先读  <em>这一</em>句。\n  Then <b>bold</b> words.</p></div>', 'text/html');
    const source = articleSpeechSource(document.querySelector('div')!, 240, false);
    const [first, second] = source.items;
    expect(first.text).toBe('先读 这一句。');
    expect(first.range!(0, 2)!.toString()).toBe('先读');
    expect(first.range!(3, 5)!.toString()).toBe('这一');
    expect(first.range!(0, first.text.length)!.toString()).toBe('先读  这一句。');
    expect(second.text).toBe('Then bold words.');
    expect(second.range!(5, 9)!.toString()).toBe('bold');
    expect(second.range!(10, 16)!.toString()).toBe('words.');
    expect(second.range!(99, 100)).toBeNull();
  });
});

describe('selection-only narration', () => {
  it('maps only the selected occurrence and excludes the surrounding sentence', () => {
    const root = new DOMParser().parseFromString('<div><p>重复句。前文。重复句。后文。</p><p>重复句。</p></div>', 'text/html').querySelector('div')!;
    const node = root.querySelector('p')!.firstChild!;
    const range = document.createRange(); range.setStart(node, 7); range.setEnd(node, 11);
    const source = articleSpeechSource(root, 240, false, range);
    expect(source.items.map(x => x.text).join('')).toBe('重复句。');
    const painted = source.items[0].range!(0, 4)!;
    expect(painted.startContainer).toBe(node); expect(painted.startOffset).toBe(7); expect(painted.endOffset).toBe(11);
  });
  it('clips both ends across inline nodes and paragraphs without changing the DOM', () => {
    const root = new DOMParser().parseFromString('<div><p>前文 <em>只读这里。</em></p><p>再读这里。后文</p></div>', 'text/html').querySelector('div')!;
    const original = root.innerHTML, range = document.createRange();
    range.setStart(root.querySelector('em')!.firstChild!, 1); range.setEnd(root.querySelectorAll('p')[1].firstChild!, 5);
    const items = articleSpeechSource(root, 240, false, range).items;
    expect(items.map(x => x.text)).toEqual(['读这里。', '再读这里。']);
    expect(items.map(x => x.range!(0, x.text.length)!.toString())).toEqual(['读这里。', '再读这里。']);
    expect(root.innerHTML).toBe(original);
  });
  it('rejects collapsed or outside ranges instead of reading the whole article', () => {
    const root = new DOMParser().parseFromString('<div>正文</div>', 'text/html').querySelector('div')!;
    const range = document.createRange(); range.selectNodeContents(root); range.collapse(true);
    expect(articleSpeechSource(root, 240, false, range).items).toEqual([]);
    range.selectNodeContents(new DOMParser().parseFromString('<p>其他文字</p>', 'text/html').querySelector('p')!);
    expect(articleSpeechSource(root, 240, false, range).items).toEqual([]);
  });
});

describe('read from here', () => {
  it('respects element boundaries and excludes preceding siblings', () => {
    const doc = new DOMParser().parseFromString('<div><p>前文。</p><p>这里。</p><p>末尾。</p></div>', 'text/html');
    const root = doc.querySelector('div')!, range = doc.createRange(); range.setStart(root, 1); range.setEnd(root, 3);
    const items = articleSpeechSource(root, 240, false, range).items;
    expect(items.map(x => x.text)).toEqual(['这里。', '末尾。']);
    expect(items.map(x => x.range!(0, x.text.length)!.toString())).toEqual(['这里。', '末尾。']);
  });
});

it('recognizes new selection boundaries even when the text is identical', () => {
  const doc = new DOMParser().parseFromString('<p>重复重复</p>', 'text/html'), node = doc.querySelector('p')!.firstChild!;
  const first = doc.createRange(); first.setStart(node, 0); first.setEnd(node, 2);
  const second = doc.createRange(); second.setStart(node, 2); second.setEnd(node, 4);
  expect(first.toString()).toBe(second.toString());
  expect(sameSpeechRange(first, first.cloneRange())).toBe(true);
  expect(sameSpeechRange(first, second)).toBe(false);
});
