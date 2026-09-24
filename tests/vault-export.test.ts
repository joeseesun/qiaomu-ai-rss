import { describe, expect, it } from 'vitest';
import { exportBaseName } from '../src/article-export';
import { availableNotePath, linkAttachments } from '../src/vault-export';
import type { Bundle } from '../src/model';

const bundle = (title: string) => ({ entry: { id: 'a', sourceId: 's', title } }) as unknown as Bundle;

describe('vault export', () => {
  it('names files after the title and mode without link-breaking characters', () => {
    expect(exportBaseName(bundle('A/B: [C] #tag^x'), 'rewrite')).toBe('A B C tag x - 乔木改写');
    expect(exportBaseName(bundle('   '), 'original')).toMatch(/^文章 - /);
  });
  it('never reuses an existing note path', () => {
    const taken = new Set(['文章/T.md', '文章/T (2).md']);
    expect(availableNotePath(p => taken.has(p), '文章', 'T')).toBe('文章/T (3).md');
    expect(availableNotePath(() => false, '文章', 'T')).toBe('文章/T.md');
  });
  it('swaps placeholder images for host-generated embeds and leaves remote images alone', () => {
    const links = new Map([['qrs-asset-0', '![[T-1.png]]'], ['qrs-asset-2', '[T-3.jpg](附件/T-3.jpg)']]);
    const md = '![a \\] b](qrs-asset-0)\n\n![](https://x.test/i.png)\n\n![c](qrs-asset-2 "t")\n\n![](qrs-asset-1)';
    expect(linkAttachments(md, links)).toBe('![[T-1.png]]\n\n![](https://x.test/i.png)\n\n![T-3.jpg](附件/T-3.jpg)\n\n![](qrs-asset-1)');
  });
});

describe('list excerpts', async () => {
  const { cleanExcerpt } = await import('../src/excerpt');
  it('drops the WeChat byline and keeps the first real sentence', () => {
    expect(cleanExcerpt('原创 数字生命卡兹克 2026-09-22 10:02 上海 新一代源神 今天凌晨')).toBe('新一代源神 今天凌晨');
    expect(cleanExcerpt('ASI启示录 2026-09-23 12:27 罗福莉带小米登顶')).toBe('罗福莉带小米登顶');
    expect(cleanExcerpt('原创 elsewhere 2026-09-20 10:00 北京 生成未知。')).toBe('生成未知。');
  });
  it('leaves ordinary summaries alone apart from Markdown marks', () => {
    expect(cleanExcerpt('见 [这篇](https://x.test) **重点**')).toBe('见 这篇 重点');
    expect(cleanExcerpt('2026-09-20 发布的新版本')).toBe('2026-09-20 发布的新版本');
  });
});

describe('saved article notes', async () => {
  const { renameArticleNotes, articleNoteKey } = await import('../src/model');
  it('follows a renamed note and a moved folder, leaving unrelated paths alone', () => {
    const notes = { [articleNoteKey('a', 'rewrite')]: '文章/A.md', [articleNoteKey('b', 'original')]: '文章/子/B.md', c: '文章二/C.md' };
    expect(renameArticleNotes(notes, '文章/A.md', '归档/A.md')).toBe(true);
    expect(renameArticleNotes(notes, '文章', '读过')).toBe(true);
    expect(notes).toEqual({ 'a|rewrite': '归档/A.md', 'b|original': '读过/子/B.md', c: '文章二/C.md' });
    expect(renameArticleNotes(notes, '无关.md', 'x.md')).toBe(false);
  });
});
