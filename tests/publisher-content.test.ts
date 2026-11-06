// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { articleFragment } from '../src/content';
import { bundleSchema, initialState, splitContentCache } from '../src/model';
import { RssApi } from '../src/api';
const entry = { id: 'xnews-fixture', sourceId: 'xnews', title: '中文标题', link: 'https://xnews.qiaomu.ai/a/test', content: '<p>Original English</p><video src="https://media.example/original.mp4" autoplay></video>' };
const rewrite = { body: '中文改写 Markdown', bodyHtml: '<p>中文改写正文</p><audio src="https://media.example/rewrite.mp3" autoplay></audio>' };
it('preserves publisher HTML through API and persisted schema, with distinct original/rewrite players', async () => {
  const api = new RssApi('https://rss.qiaomu.ai', async url => ({ status: 200, text: JSON.stringify(url.endsWith('/rewrite') ? { rewrite } : url.endsWith('/translation') ? { translation: null } : { entry, rewrite }) }));
  const { bundle } = await api.article(entry.id);
  expect(bundle.rewrite).toMatchObject(rewrite);
  const restored = initialState({ cache: { [entry.id]: bundle } }).cache[entry.id];
  const original = articleFragment(restored, 'original', document, true)!;
  const chinese = articleFragment(restored, 'rewrite', document, true)!;
  expect(original.textContent).toContain('Original English');
  expect(original.textContent).not.toContain('中文改写正文');
  expect(original.querySelector('video[controls][preload="none"]')).not.toBeNull();
  expect(chinese.querySelector('audio[controls][preload="none"]')).not.toBeNull();
  expect(chinese.textContent).toContain('中文改写正文');
  expect(chinese.querySelector('[autoplay]')).toBeNull();
  api.dispose();
});
it('loads only an allowlisted YouTube embed on click and strips unsafe media', () => {
  const bundle = bundleSchema.parse({ entry: { ...entry, content: '<iframe src="https://www.youtube.com/embed/abcdefghijk?autoplay=1"></iframe><iframe src="https://evil.example/embed/abcdefghijk"></iframe><video src="javascript:alert(1)" onplay="evil()"><source src="https://media.example/movie.mp4"></video>' }, rewrite, translation: null, fetchedAt: 1 });
  const fragment = articleFragment(bundle, 'original', document, true)!;
  expect(fragment.querySelectorAll('iframe')).toHaveLength(0);
  expect(fragment.querySelectorAll('button')).toHaveLength(1);
  fragment.querySelector('button')!.click();
  expect(fragment.querySelectorAll('iframe')).toHaveLength(1);
  expect(fragment.querySelector('iframe')?.src).toContain('https://www.youtube-nocookie.com/embed/abcdefghijk');
  expect(fragment.querySelector('[onplay],[src^="javascript:"]')).toBeNull();
});
it('an older saved snapshot cannot overwrite a newly synchronized original in the shared body cache', () => {
  const fresh = bundleSchema.parse({ entry, rewrite, translation: null, fetchedAt: 20 });
  const old = { ...fresh, entry: { ...entry, content: '<h2>乔木改写</h2><p>mixed old original</p>' }, fetchedAt: 1 };
  const state = initialState({ cache: { [entry.id]: fresh }, savedArticles: { [entry.id]: old } });
  expect(splitContentCache(state).cache[entry.id]).toBe(entry.content);
  expect(state.savedArticles[entry.id].entry.content).toContain('mixed old original');
});
