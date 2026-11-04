// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
import { articleFragment } from '../src/content';
import { articleNoteUrl, appendDailyNoteLink, dailyNoteLink, dailyNotePath, excerptBlock, renderDailyNoteTemplate } from '../src/daily-note';
import { DEFAULT_EXCERPT_TEMPLATE, folderPath, initialState, withServiceOrigin, safeUrl, serviceUrl, type Bundle } from '../src/model';
const bundle: Bundle = {
  entry: { id: 'abc123', sourceId: 'example', title: 'Title: "quotes"\n---', link: 'https://example.com/news', content: '<h2>Original</h2><p>Full text</p>' },
  rewrite: { body: '# Title\n\n**Hello** [source](/path)\n\n```dataviewjs\nthrow Error("never execute");\n```' },
  translation: { content: [{ target: '<script>literal text</script>' }, { targetHtml: '<p>中文</p>' }] }, fetchedAt: 1,
};
describe('untrusted remote content', () => {
  it('opens cached WeChat feed launch links as HTTPS articles without the app redirect', () => {
    const original = 'https://mp.weixin.qq.com/s?__biz=abc%3D%3D&mid=123&idx=1&sn=def';
    const proxy = `https://wechat2rss.bestblogs.dev/link-proxy/?k=42047b24&r=1&u=${encodeURIComponent(original)}`;
    const value = structuredClone(bundle);
    value.entry.content = `<p>Cached article</p><a href="${proxy.replace(/&/g, '&amp;')}">跳转微信打开</a>`;
    const fragment = articleFragment(value, 'original', document, false)!;
    const link = fragment.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(original);
    expect(link.textContent).toBe('查看公众号原文');
    expect(link.target).toBe('_blank');
    expect(value.entry.content).toContain('link-proxy/');
  });
  it('leaves unrelated, malformed and unsafe proxy destinations unchanged', () => {
    const links = [
      'https://wechat2rss.bestblogs.dev.evil.test/link-proxy/?u=https%3A%2F%2Fmp.weixin.qq.com%2Fs%2Fabc',
      'https://wechat2rss.bestblogs.dev/img-proxy/?u=https%3A%2F%2Fmp.weixin.qq.com%2Fs%2Fabc',
      'https://wechat2rss.bestblogs.dev/link-proxy/?u=javascript%3Aalert(1)',
      'https://wechat2rss.bestblogs.dev/link-proxy/?u=https%3A%2F%2Fmp.weixin.qq.com.evil.test%2Fs%2Fabc',
      'https://wechat2rss.bestblogs.dev/link-proxy/?u=https%3A%2F%2Fu%3Ap%40mp.weixin.qq.com%2Fs%2Fabc',
      'https://wechat2rss.bestblogs.dev/link-proxy/?u=%E0%A4%A',
      'https://wechat2rss.bestblogs.dev/link-proxy/',
    ];
    const value = structuredClone(bundle);
    value.entry.content = links.map(href => `<a href="${href}">source</a>`).join('');
    const fragment = articleFragment(value, 'original', document, false)!;
    expect([...fragment.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(links);
  });
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
  it('renders excerpts with a linked section and an original link', () => {
    const entry = { ...bundle.entry, title: 'Plain title' };
    const options = { vault: 'QA', article: 'a', excerpt: 'First line\n\nSecond line', template: DEFAULT_EXCERPT_TEMPLATE };
    const first = appendDailyNoteLink('', entry, options);
    expect(first.content).toContain('> First line\n> \n> Second line\n>\n> ↳ [Plain title](<' + articleNoteUrl(options) + '>) · [原文 ↗](<https://example.com/news>)');
    expect(appendDailyNoteLink(first.content, entry, options).added).toBe(false);
    expect(appendDailyNoteLink(first.content, entry, { ...options, excerpt: 'Third' }).added).toBe(true);
  });
  it('keeps excerpts inert inside custom templates, passes HTML through and never drops the text', () => {
    const now = { format: (format: string) => ({ 'YYYY-MM-DD': '2026-10-24', 'HH:mm': '09:05' })[format] || format } as never;
    expect(excerptBlock('<script>bold</script>', bundle.entry, { template: '<div>{{content}}</div>' }, now)).toBe('<div>\\<script\\>bold\\</script\\></div>');
    expect(excerptBlock('A\nB', bundle.entry, { template: '> {{content}}\n> — {{date}} {{time}}' }, now)).toBe('> A\n> B\n> — 2026-10-24 09:05');
    expect(excerptBlock('Body', bundle.entry, { template: '## 摘录' }, now)).toBe('## 摘录\n\nBody');
    expect(excerptBlock('Body', bundle.entry, {}, now)).toBe('Body');
  });
  it.each([
    ['- {{CONTENT}}\n\n> {{ content }}', '- A\n\n  B\n\n> A\n> \n> B'],
    ['1. {{content}}', '1. A\n\n   B'],
    ['Before {{content}}', 'Before A\n\nB'],
    ['{{unknown}}', '{{unknown}}\n\nA\n\nB'],
    ['   ', 'A\n\nB'],
  ])('preserves excerpt formatting for template %j', (template, expected) => {
    expect(excerptBlock('A\n\nB', bundle.entry, { template })).toBe(expected);
  });
  it('expands link, url and title tokens with the saved reading link', () => {
    const block = excerptBlock('Quote', bundle.entry, { vault: 'QA', article: 'a', template: '{{content}}\n\n-- {{title}} · {{link}} · {{url}}' });
    expect(block).toContain('-- Title: "quotes" \\-\\-\\- · [Title: "quotes" \\-\\-\\-](<obsidian://qiaomu-ai-rss?');
    expect(block).toContain('https://example.com/news');
  });
  it('adds an escaped section suffix only when the selection has a section heading', () => {
    const template = '— {{source}}{{section}}';
    const source = excerptBlock('Body', bundle.entry, { template });
    expect(source).not.toContain(' · ');
    expect(source).not.toContain('{{section}}');
    expect(excerptBlock('Body', bundle.entry, { template, section: '  Small\n plots <script> [x] {{date}}  ' })).toBe(source.replace('\n\nBody', ' · Small plots \\<script\\> \\[x\\] \\{\\{date\\}\\}\n\nBody'));
    expect(excerptBlock('Body', bundle.entry, { template, section: '   ' })).toBe(source);
  });
  it('links section text to the selected reading mode without changing the grouped article header', () => {
    const options = { vault: 'QA 中文', article: 'a/b', mode: 'rewrite' as const, section: ' 跑分\n对比 [A] ', template: '{{section_link}}\n\n{{content}}' };
    const link = articleNoteUrl(options, options.section);
    const params = new URL(link).searchParams;
    expect(params.get('section')).toBe('跑分 对比 [A]');
    expect(params.get('mode')).toBe('rewrite');
    expect(params.get('vault')).toBe('QA 中文');
    expect(excerptBlock('Body', bundle.entry, options)).toBe('[跑分 对比 \\[A\\]](<' + link + '>)\n\nBody');
    expect(new URL(articleNoteUrl(options)).searchParams.has('section')).toBe(false);
    expect(excerptBlock('Body', { ...bundle.entry, title: 'Article' }, { ...options, section: '' })).toBe('[Article](<' + articleNoteUrl(options) + '>)\n\nBody');
  });
  it('embeds a text quote only in excerpt links, keeping section links and headers unchanged', () => {
    const quote = { type: 'TextQuoteSelector' as const, exact: '测试 + emoji 😀 <script>', prefix: 'before ', suffix: ' after' };
    const options = { vault: 'QA', article: 'a', mode: 'rewrite' as const, section: 'Heading', quote };
    const url = articleNoteUrl(options, options.section, quote);
    expect(JSON.parse(new URL(url).searchParams.get('quote')!)).toEqual(quote);
    expect(url).not.toContain('+');
    expect(excerptBlock('Body', bundle.entry, { ...options, template: '{{excerpt_link}}' })).toBe('[Heading](<' + url + '>)\n\nBody');
    expect(excerptBlock('Body', bundle.entry, { ...options, template: '{{section_link}}' })).not.toContain('quote=');
    expect(dailyNoteLink(bundle.entry, options)).not.toContain('quote=');
    expect(excerptBlock('Body', { ...bundle.entry, title: 'Article' }, { ...options, section: '', template: '{{excerpt_link}}' })).toBe('[Article](<' + articleNoteUrl(options, '', quote) + '>)\n\nBody');
  });
  it('adds browser text fragments only to external original-mode source links and preserves heading anchors', () => {
    const entry = { ...bundle.entry, link: 'https://example.com/post?q=1#chapter:~:text=old' };
    const options = { mode: 'original' as const, template: '{{content}}\n\n{{original_link}}', textFragment: 'text=First%20part,Last%20part' };
    expect(excerptBlock('Body', entry, options)).toBe('Body\n\n[原文定位 ↗](<https://example.com/post?q=1#chapter:~:text=First%20part,Last%20part>)');
    for (const mode of ['rewrite', 'translation'] as const) {
      expect(excerptBlock('Body', entry, { ...options, mode })).toBe('Body\n\n[原文 ↗](<https://example.com/post?q=1#chapter:~:text=old>)');
    }
    expect(excerptBlock('Body', bundle.entry, options)).toContain('https://example.com/news#:~:text=First%20part,Last%20part');
    expect(excerptBlock('Body', bundle.entry, { ...options, textFragment: undefined })).toBe('Body\n\n[原文 ↗](<https://example.com/news>)');
    expect(excerptBlock('Body', bundle.entry, { ...options, template: '{{url}}' })).toBe('https://example.com/news\n\nBody');
  });
  it('never adds browser text fragments to unsafe URLs or vault note links', () => {
    const entry = { ...bundle.entry, origin: 'vault' as const, link: 'javascript:alert(1)', markdownPath: 'Source.md' };
    const block = excerptBlock('Body', entry, { vault: 'QA', article: 'vault:a', mode: 'original', template: '{{original_link}}', textFragment: 'text=Body' });
    expect(block).not.toContain('javascript:'); expect(block).not.toContain(':~:');
    expect(block).toContain('obsidian://open?');
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
    expect(initialState({}).settings.excerptTemplate).toBe(DEFAULT_EXCERPT_TEMPLATE);
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
    expect(transport.mock.calls[0][0]).toBe('https://rss.qiaomu.ai/api/sources/a%2Fb/entries?limit=40&cursor=x%2By');
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
