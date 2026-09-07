// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
import { articleFragment } from '../src/content';
import { articleNoteUrl, appendDailyNoteLink, dailyNoteLink, dailyNotePath, renderDailyNoteTemplate } from '../src/daily-note';
import { folderPath, initialState, withServiceOrigin, safeUrl, serviceUrl, type Bundle } from '../src/model';
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
  it('appends only a linked title to a daily note and avoids duplicates', () => {
    const entry = { ...bundle.entry, title: 'Plain title' };
    expect(dailyNoteLink(entry)).toBe('[Plain title](<https://example.com/news>)');
    const first = appendDailyNoteLink('# Daily\n', bundle.entry);
    expect(first.content).toContain('# Daily\n\n' + dailyNoteLink(bundle.entry) + '\n\n');
    expect(first.content).not.toMatch(/^- /m);
    expect(appendDailyNoteLink(first.content, bundle.entry)).toEqual({ content: first.content, added: false });
    expect(first.content).not.toContain('Full text'); expect(first.content).not.toContain('rss_id');
  });
  it('captures inert excerpts with vault-scoped internal article links', () => {
    const options = { vault: '中文 & QA', article: 'https://rss.qiaomu.ai|a/b', mode: 'rewrite' as const, excerpt: 'A paragraph\n\n- item <script> [link](evil) `code`' };
    const url = new URL(articleNoteUrl(options));
    expect(url.searchParams.get('vault')).toBe(options.vault);
    expect(articleNoteUrl(options)).not.toContain('+');
    expect(articleNoteUrl(options)).toContain('%20');
    expect(url.searchParams.get('article')).toBe(options.article);
    expect(url.searchParams.get('mode')).toBe('rewrite');
    const first = appendDailyNoteLink('', bundle.entry, options);
    expect(first.content).toContain('obsidian://qiaomu-ai-rss?');
    expect(first.content).toContain('[原文](<https://example.com/news>)');
    expect(first.content).not.toMatch(/^- /m);
    expect(first.content).not.toContain('<script>');
    expect(appendDailyNoteLink(first.content, bundle.entry, options).added).toBe(false);
    expect(appendDailyNoteLink(first.content, bundle.entry, { ...options, excerpt: 'Another paragraph' }).added).toBe(true);
  });
  it('groups A B A excerpts under one source title and preserves other notes', () => {
    const a = { article: 'a', vault: 'Qiaomu RSS QA', excerpt: 'First A' };
    let content = appendDailyNoteLink('# My note\n', bundle.entry, a).content;
    content = appendDailyNoteLink(content, { ...bundle.entry, title: 'B' }, { ...a, article: 'b', excerpt: 'First B' }).content;
    content = appendDailyNoteLink(content, bundle.entry, { ...a, excerpt: 'Second A' }).content;
    expect(content.split('obsidian://qiaomu-ai-rss?')).toHaveLength(3);
    expect(content.indexOf('Second A')).toBeLessThan(content.indexOf('First B'));
    expect(content).toContain('# My note');
    expect(appendDailyNoteLink(content, bundle.entry, { ...a, excerpt: 'Second A' }).added).toBe(false);
  });
  it('recognizes old links and repairs form-encoded vault spaces without repeating title', () => {
    const a = { article: 'a', vault: 'Qiaomu RSS QA', excerpt: 'Second' };
    const old = dailyNoteLink(bundle.entry, a).replace(/%20/g, '+') + '\n\nFirst\n\n';
    const result = appendDailyNoteLink(old, bundle.entry, a);
    expect(result.content).not.toContain('Qiaomu+RSS+QA');
    expect(result.content.split('obsidian://qiaomu-ai-rss?')).toHaveLength(2);
    expect(result.content).toContain('First\n\nSecond');
  });
  it('adds an original link to an existing grouped header without duplicating it', () => {
    const options = { article: 'a', vault: 'QA', excerpt: 'First' };
    const old = appendDailyNoteLink('', bundle.entry, options).content.replace(' · [原文](<https://example.com/news>)', '');
    const upgraded = appendDailyNoteLink(old, bundle.entry, { ...options, excerpt: 'Second' }).content;
    expect(upgraded.split('[原文]')).toHaveLength(2);
    expect(appendDailyNoteLink(upgraded, bundle.entry, options).content.split('[原文]')).toHaveLength(2);
  });
  it('removes legacy capture markers while keeping grouped excerpts and notes', () => {
    const options = { vault: 'QA', article: 'local:test', excerpt: 'First excerpt' };
    const first = appendDailyNoteLink('', bundle.entry, options).content;
    expect(first).not.toContain('qrs-article:');
    const legacy = first + '<!-- qrs-article:local%3Atest -->\n\nPersonal note\n';
    const next = appendDailyNoteLink(legacy, bundle.entry, { ...options, excerpt: 'Second excerpt' }).content;
    expect(next).not.toContain('qrs-article:');
    expect(next).toContain('Personal note');
    expect(next).toContain('First excerpt');
    expect(next).toContain('Second excerpt');
    expect(next.split('[原文]')).toHaveLength(2);
  });
  it('links local Markdown captures back to their source file without a web URL', () => {
    const entry = { ...bundle.entry, origin: 'vault' as const, link: null, markdownPath: 'Clippings/My article.md' };
    const link = dailyNoteLink(entry, { vault: 'Qiaomu RSS QA', article: 'vault:file' });
    expect(link).toContain('[原文](<obsidian://open?vault=Qiaomu%20RSS%20QA&file=Clippings%2FMy%20article.md>)');
  });
  it('respects daily-note folders, formats and common template tokens', () => {
    const now = { format: (format: string) => ({ 'YYYY/MM/DD': '2026/09/07', 'YYYY-MM-DD': '2026-09-07', 'HH:mm': '12:30' })[format] || format } as never;
    expect(dailyNotePath({ folder: 'Daily', format: 'YYYY/MM/DD', template: '' }, now)).toBe('Daily/2026/09/07.md');
    expect(renderDailyNoteTemplate('# {{title}}\n{{date}} {{time}}', '2026-09-07', now)).toBe('# 2026-09-07\n2026-09-07 12:30');
  });
});
describe('paths and persistence', () => {
  it('rejects path traversal, hidden folders and absolute paths', () => {
    for (const value of ['../secret', '.obsidian', '/tmp', 'a//b', 'a/../b', 'C:\\x']) expect(() => folderPath(value)).toThrow();
    expect(folderPath('阅读/文章')).toBe('阅读/文章');
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
  it('preserves saved article links through cache and service changes', () => {
    expect(initialState({}).savedArticles).toEqual({});
    const state = initialState({ savedArticles: { saved: bundle } });
    const restored = initialState(JSON.parse(JSON.stringify(state)));
    expect(withServiceOrigin(restored, 'https://example.com').savedArticles.saved).toEqual(bundle);
  });
  it('defaults the selection popup on and persists folder sources and opt-in', () => {
    expect(initialState({}).settings.selectionPopup).toBe(true);
    const state = initialState({ settings: { selectionPopup: true, markdownFolders: ['Clippings', 'Articles'] } });
    expect(initialState(JSON.parse(JSON.stringify(state))).settings).toMatchObject({ selectionPopup: true, markdownFolders: ['Clippings', 'Articles'] });
  });
  it('migrates and persists compact reading appearance settings', () => {
    expect(initialState({ settings: {} }).settings).toMatchObject({ fontSize: 19, fontFamily: 'fangsong', lineHeight: 1.9, lineWidth: 36 });
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
  it('does not let remote entries impersonate vault Markdown', async () => {
    const entry = { ...bundle.entry, origin: 'vault', markdownPath: 'Secret.md', markdown: 'private' };
    const api = new RssApi('https://rss.qiaomu.ai', async () => ({ status: 200, text: JSON.stringify({ entries: [entry] }) }));
    const result = await api.entries();
    expect(result.entries[0]).toMatchObject({ origin: 'qiaomu' });
    expect(result.entries[0].markdownPath).toBeUndefined();
    expect(result.entries[0].markdown).toBeUndefined();
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
