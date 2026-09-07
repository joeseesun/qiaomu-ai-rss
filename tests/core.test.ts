// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
import { articleFragment, noteMarkdown } from '../src/content';
import { folderPath, initialState, noteName, safeUrl, serviceUrl, type Bundle } from '../src/model';
const bundle: Bundle = {
  entry: { id: 'abc123', sourceId: 'example', title: 'Title: "quotes"\n---', link: 'https://example.com/news', content: '<h2>Original</h2><p>Full text</p>' },
  rewrite: { body: '# Title\n\n**Hello** [source](/path)\n\n```dataviewjs\nthrow Error("never execute");\n```' },
  translation: { content: [{ target: '<script>literal text</script>' }, { targetHtml: '<p>中文</p>' }] }, fetchedAt: 1,
};
describe('untrusted remote content', () => {
  it('removes executable elements, handlers, CSS, embeds and unsafe URL schemes', () => {
    const value = structuredClone(bundle);
    value.entry.content = '<script>window.pwned=1</script><iframe src="https://evil.com"></iframe><style>body{display:none}</style><p id="app" style="color:red" onclick="evil()">safe</p><a href="javascript:evil()">bad</a><a href="obsidian://open?vault=private">vault</a><img src="https://example.com/tracker" onerror="evil()"><svg onload="evil()"></svg>';
    const fragment = articleFragment(value, 'original', document, false)!;
    expect(fragment.querySelector('script,iframe,style,img,svg,[id],[style],[onclick]')).toBeNull();
    expect([...fragment.querySelectorAll('a')].every(a => !a.hasAttribute('href'))).toBe(true);
    expect(fragment.textContent).toContain('safe');
  });
  it('normalizes relative links and applies image and link protections', () => {
    const value = structuredClone(bundle); value.entry.content = '<a href="/link">link</a><img src="/image.png"><img src="data:image/svg+xml,bad">';
    const fragment = articleFragment(value, 'original', document, true)!;
    expect(fragment.querySelector('a')?.href).toBe('https://example.com/link');
    expect(fragment.querySelector('a')?.rel).toContain('noopener');
    expect(fragment.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(fragment.querySelectorAll('img')[1].hasAttribute('src')).toBe(false);
  });
  it('renders remote code fences as inert text', () => {
    const fragment = articleFragment(bundle, 'rewrite', document, false)!;
    expect(fragment.querySelector('pre code')?.textContent).toContain('never execute');
    expect(fragment.querySelector('[class]')).toBeNull();
  });
  it('escapes plain translation strings and reports missing assets', () => {
    const fragment = articleFragment(bundle, 'translation', document, false)!;
    expect(fragment.querySelector('script')).toBeNull();
    expect(fragment.textContent).toContain('<script>literal text</script>');
    expect(articleFragment({ ...bundle, rewrite: null }, 'rewrite', document, false)).toBeNull();
  });
  it('exports safe frontmatter and inert Markdown with provenance', () => {
    const note = noteMarkdown(bundle, 'rewrite', document, false);
    expect(note).toContain('rss_id: "abc123"');
    expect(note).toContain('title: "Title: \\"quotes\\"\\n---"');
    expect(note).not.toContain('```dataviewjs');
    expect(note).toContain('[source](https://example.com/path)');
    expect(() => noteMarkdown({ ...bundle, rewrite: null }, 'rewrite', document, false)).toThrow();
  });
});
describe('paths and persistence', () => {
  it('rejects path traversal, hidden folders and absolute paths', () => {
    for (const value of ['../secret', '.obsidian', '/tmp', 'a//b', 'a/../b', 'C:\\x']) expect(() => folderPath(value)).toThrow();
    expect(folderPath('阅读/文章')).toBe('阅读/文章');
    expect(noteName(bundle.entry, 'rewrite')).not.toMatch(/[/:*?"<>|\n]/);
  });
  it('accepts HTTPS origins only, without embedded credentials', () => {
    expect(serviceUrl('https://rss.qiaomu.ai/')).toBe('https://rss.qiaomu.ai');
    for (const url of ['http://example.com', 'https://name:secret@example.com', 'https://example.com/path', 'https://example.com?token=secret']) expect(() => serviceUrl(url)).toThrow();
    expect(safeUrl('javascript:alert(1)')).toBeNull();
  });
  it('round trips favorites and cached content', () => {
    const state = initialState({ favorites: { abc123: bundle }, cache: { abc123: bundle }, readIds: ['abc123'] });
    expect(initialState(JSON.parse(JSON.stringify(state))).favorites.abc123.entry.id).toBe('abc123');
  });
  it('migrates and persists compact reading appearance settings', () => {
    expect(initialState({ settings: {} }).settings).toMatchObject({ fontSize: 19, fontFamily: 'serif', lineHeight: 1.9, lineWidth: 36 });
    const state = initialState({ settings: { fontSize: 24, fontFamily: 'sans', lineHeight: 2.2, lineWidth: 44 } });
    expect(initialState(JSON.parse(JSON.stringify(state))).settings).toMatchObject({ fontSize: 24, fontFamily: 'sans', lineHeight: 2.2, lineWidth: 44 });
  });
});
describe('API contract and failures', () => {
  it('uses encoded channel paths and cursor query', async () => {
    const transport = vi.fn(async () => ({ status: 200, text: '{"entries":[],"hasMore":true,"nextCursor":"next"}' }));
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    await api.entries('a/b', 'x+y');
    expect(transport.mock.calls[0][0]).toBe('https://rss.qiaomu.ai/api/sources/a%2Fb/entries?limit=40&ready=rewrite&cursor=x%2By');
  });
  it('rejects HTTP and schema errors without rendering server error HTML', async () => {
    await expect(new RssApi('https://rss.qiaomu.ai', async () => ({ status: 503, text: '<secret>' })).entries()).rejects.toThrow('HTTP 503');
    await expect(new RssApi('https://rss.qiaomu.ai', async () => ({ status: 200, text: '{"entries":[{}]}' })).entries()).rejects.toThrow('格式不兼容');
  });
  it('retains usable article when an optional asset endpoint fails', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async url => url.endsWith('/rewrite') ? { status: 503, text: '' } : { status: 200, text: JSON.stringify(url.endsWith('/translation') ? { translation: null } : { entry: bundle.entry }) });
    const result = await api.article('abc123');
    expect(result.bundle.entry.id).toBe('abc123'); expect(result.warnings).toHaveLength(1);
  });
  it('times out stalled requests', async () => {
    vi.useFakeTimers();
    const api = new RssApi('https://rss.qiaomu.ai', () => new Promise(() => {}));
    const assertion = expect(api.entries()).rejects.toThrow('请求超时');
    await vi.advanceTimersByTimeAsync(20001); await assertion; vi.useRealTimers();
  });
});
