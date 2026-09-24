// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { articleExportBody, articleExportMarkdown } from '../src/article-export';
import { markdownAssetPath, relativeAssetPath, renderExportTemplate, safeFilenamePart, vaultExportPath } from '../src/export-paths';
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

  it('renders safe export templates with article metadata', () => {
    expect(safeFilenamePart(' A/B:*?"<>|#\n ')).toBe('A B');
    expect(renderExportTemplate('{date}/{source}/{title}-{mode}-{id}', bundle, 'original', new Date('2026-09-23T08:09:10Z'))).toContain('article');
  });

  it('resolves Markdown and image folders from the vault root independently', () => {
    const localBundle = { ...bundle, entry: { ...bundle.entry, title: '一篇文章', sourceName: '示例频道', publishedTs: Date.UTC(2026, 8, 23) } };
    const paths = vaultExportPath('D:/Vault', localBundle, 'original', {
      exportFolder: 'Articles/{source}',
      exportFilename: '{date}-{title}.md',
      exportAssetFolder: 'Attachments/{source}/{filename}',
    }, new Date('2026-09-23T08:09:10Z'));
    expect(paths.markdownFile).toBe('D:/Vault/Articles/示例频道/2026-09-23-一篇文章.md');
    expect(paths.assetFolder).toBe('D:/Vault/Attachments/示例频道/2026-09-23-一篇文章');
    expect(relativeAssetPath(paths.markdownFile, `${paths.assetFolder}/image-1.png`)).toBe('../../Attachments/示例频道/2026-09-23-一篇文章/image-1.png');
  });

  it('keeps local image paths readable after filename placeholders are sanitized', () => {
    expect(markdownAssetPath('D:/Vault/Inbox/a.md', 'D:/Vault/70-Assets/图片/文章图床/Weekly 003｜Next Token/image-1.jpg'))
      .toBe('../70-Assets/图片/文章图床/Weekly 003｜Next Token/image-1.jpg');
    const body = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('alt', 'cover');
    img.setAttribute('src', markdownAssetPath('D:/Vault/Inbox/a.md', 'D:/Vault/70-Assets/图片/文章图床/Weekly 003｜Next Token/image-1.jpg'));
    body.append(img);
    expect(articleExportMarkdown(bundle, 'original', body)).toContain('](<../70-Assets/图片/文章图床/Weekly 003｜Next Token/image-1.jpg>)');
  });
});
