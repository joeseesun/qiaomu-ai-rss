// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { articleSpeechSource } from './speech-source';
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
});
