// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { articleFragment } from '../src/content';
import type { Bundle } from '../src/model';

function render(body: string, images = true) {
  const bundle: Bundle = {
    entry: { id: 'image-regression', sourceId: 'latentspace', title: 'Images', link: 'https://www.latent.space/p/ainews-deepseek-deepinfer-open-source' },
    rewrite: { body }, translation: null, fetchedAt: 1,
  };
  return articleFragment(bundle, 'rewrite', document, images)!;
}

describe('rewrite image Markdown', () => {
  // The cached DeepInfer rewrite contains three of these unclosed alt-text brackets.
  const url = 'https://substackcdn.com/image/fetch/$s_!rRsx!,w_1456,c_limit,f_auto,q_auto:good/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fexample.png';
  it('recovers standalone image references with unbalanced alt brackets', () => {
    const fragment = render(`Before\n\n![[image](${url})\n\n![[Image preview](${url})\n\nAfter`);
    expect([...fragment.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual([url, url]);
    expect(fragment.querySelector('a')).toBeNull();
    expect(fragment.textContent).toContain('Before');
    expect(fragment.textContent).toContain('After');
    expect(fragment.textContent).not.toContain('![image');
  });
  it('keeps valid nested alt text and URLs with parentheses', () => {
    const fragment = render(`![[AINews] DeepInfer](${url})\n\n![[image](https://example.com/image(2).png)`);
    expect([...fragment.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual([url, 'https://example.com/image(2).png']);
  });
  it('leaves code examples, Obsidian embeds and ordinary links intact', () => {
    const fragment = render('```md\n![[image](' + url + ')\n```\n\n`![[image](' + url + ')`\n\n![[local.png]]\n\n[image](' + url + ')');
    expect(fragment.querySelector('img')).toBeNull();
    expect(fragment.querySelector('pre code')?.textContent).toContain('![[image]');
    expect(fragment.querySelectorAll('code')).toHaveLength(2);
    expect(fragment.textContent).toContain('![[local.png]]');
    expect(fragment.querySelector('a')?.getAttribute('href')).toBe(url);
  });
  it('respects disabled remote images and sanitizes repaired references', () => {
    expect(render(`![[image](${url})`, false).querySelector('img')).toBeNull();
    const fragment = render(`![[<script>alert(1)</script> "](${url})\n\n![[image](javascript:alert(1))`);
    expect(fragment.querySelector('script,[onerror],[onclick]')).toBeNull();
    expect(fragment.querySelector('img')?.getAttribute('src')).toBe(url);
    expect(fragment.querySelector('img')?.attributes.length).toBeLessThanOrEqual(4);
    expect(fragment.querySelector('[src^="javascript:"]')).toBeNull();
  });
});
