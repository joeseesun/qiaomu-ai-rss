// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { articleExportBody, articleExportMarkdown } from '../src/article-export';
import type { Bundle } from '../src/model';

const bundle: Bundle = {
  entry: {
    id: 'article', sourceId: 'feed', title: '一篇文章', sourceName: '示例频道',
    link: 'https://example.com/post',
    content: '<p><strong>重要结论。</strong>后续内容 <a href="/next">下一篇</a></p><table><thead><tr><th>列</th></tr></thead><tbody><tr><td>值</td></tr></tbody></table><img src="/cover.png" alt="封面"><script>evil()</script>',
  },
  rewrite: { body: '## 改写小节\n\n段落与 **重点**。' },
  translation: null, fetchedAt: 1,
};

describe('article Markdown export', () => {
  it('exports the HTTPS article instead of the feed app-launch proxy', () => {
    const original = 'https://mp.weixin.qq.com/s/Abc_123-xyz';
    const proxy = `https://wechat2rss.bestblogs.dev/link-proxy?u=${encodeURIComponent(original)}&r=1`;
    const cached = { ...bundle, entry: { ...bundle.entry, content: `<a href="${proxy}">跳转到微信打开</a>` } };
    const markdown = articleExportMarkdown(cached, 'original', articleExportBody(cached, 'original', document, true))!;
    expect(markdown).toContain(`[查看公众号原文](${original})`);
    expect(markdown).not.toContain('link-proxy');
  });
  it('preserves displayed structure, safe links, image references and Chinese-adjacent emphasis', () => {
    const body = articleExportBody(bundle, 'original', document, true);
    const markdown = articleExportMarkdown(bundle, 'original', body)!;
    const rendered = marked.parse(markdown, { async: false });
    expect(markdown).toContain('https://example.com/next');
    expect(markdown).toContain('https://example.com/cover.png');
    expect(markdown).toContain('| 列 |');
    expect(rendered).toContain('<strong>重要结论。</strong>');
    expect(rendered).toContain('后续内容');
    expect(rendered).not.toContain('evil()');
    expect(articleExportMarkdown(bundle, 'original', articleExportBody(bundle, 'original', document, false))).not.toContain('cover.png');
  });

  it('exports the selected reading version and leaves an existing vault Markdown source intact', () => {
    const rewritten = articleExportMarkdown(bundle, 'rewrite', articleExportBody(bundle, 'rewrite', document, true))!;
    expect(rewritten).toContain('## 改写小节');
    expect(rewritten).not.toContain('重要结论');
    const local = { ...bundle, entry: { ...bundle.entry, origin: 'vault' as const, markdown: '---\ntags: [a]\n---\n\n# 原有标题\n' } };
    expect(articleExportMarkdown(local, 'original', null)).toBe(local.entry.markdown);
    expect(articleExportMarkdown({ ...bundle, rewrite: null }, 'rewrite', articleExportBody({ ...bundle, rewrite: null }, 'rewrite', document, true))).toBeNull();
  });
});
