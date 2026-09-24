// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { searchPodcasts, searchWechat } from '../src/source-catalog';

const request = vi.mocked(requestUrl);
beforeEach(() => request.mockReset());

describe('online source catalogs', () => {
  it('reads the Reader WeChat catalog and ignores forged feed addresses', async () => {
    const id = 'a'.repeat(40);
    request.mockResolvedValue({ status: 200, text: JSON.stringify({ total: 12, accounts: [
      { id, name: '测试号', feedUrl: `https://wechat2rss.bestblogs.dev/feed/${id}.xml` },
      { id: 'b'.repeat(40), name: '伪造地址', feedUrl: 'https://other.example/feed.xml' },
    ] }) } as never);
    const { total, feeds } = await searchWechat('https://rss.qiaomu.ai', '测试');
    expect(total).toBe(12);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('q=%E6%B5%8B%E8%AF%95') }));
    expect(feeds.map(feed => feed.name)).toEqual(['测试号']);
    expect(feeds[0]).not.toHaveProperty('description');
  });
  it('puts curated creator and media accounts first without losing catalog entries', async () => {
    const accounts = [
      ['a'.repeat(40), '普通账号'],
      ['c442206ec9957f3c52f2f40300ca532079538b31', '晚点LatePost'],
      ['6cef434b771dd75a91864b2e699a622cb4e3eb33', 'AGENT橘'],
      ['ff621c3e98d6ae6fceb3397e57441ffc6ea3c17f', '数字生命卡兹克'],
      ['b'.repeat(40), '另一个账号'],
    ].map(([id, name]) => ({ id, name, feedUrl: `https://wechat2rss.bestblogs.dev/feed/${id}.xml` }));
    request.mockResolvedValue({ status: 200, text: JSON.stringify({ total: accounts.length, accounts }) } as never);
    const all = await searchWechat('https://rss.qiaomu.ai', '');
    expect(all.total).toBe(5);
    expect(all.feeds.map(feed => feed.name)).toEqual(['数字生命卡兹克', 'AGENT橘', '晚点LatePost', '普通账号', '另一个账号']);
    const searched = await searchWechat('https://rss.qiaomu.ai', 'AI');
    expect(searched.feeds.map(feed => feed.name)).toEqual(accounts.map(account => account.name));
  });
  it('searches Reader podcasts and keeps valid slugs for direct transcript reading', async () => {
    request.mockResolvedValue({ status: 200, text: JSON.stringify({ podcasts: [
      { slug: 'invest-like-the-best', name: 'Invest Like the Best' },
      { slug: '../unsafe', name: 'Bad result' },
    ] }) } as never);
    await expect(searchPodcasts('https://rss.qiaomu.ai', 'Invest')).rejects.toThrow();
    request.mockResolvedValue({ status: 200, text: JSON.stringify({ podcasts: [{ slug: 'invest-like-the-best', name: 'Invest Like the Best' }] }) } as never);
    expect(await searchPodcasts('https://rss.qiaomu.ai', 'Invest')).toEqual([{ slug: 'invest-like-the-best', name: 'Invest Like the Best' }]);
  });

});
