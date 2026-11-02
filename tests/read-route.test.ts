// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
import { recoverRead } from '../src/read-request';
afterEach(() => vi.useRealTimers());
it('recovers an official connection failure through the alternate route and remembers it', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async (url: string) => {
    if (new URL(url).hostname === 'rss.qiaomu.ai') throw Error('net::ERR_CONNECTION_RESET');
    return { status: 200, text: '{"entries":[]}' };
  });
  const api = new RssApi('https://rss.qiaomu.ai', transport);
  const result = api.entries().then(value => value, error => ({ error: error.message }));
  await vi.advanceTimersByTimeAsync(2001);
  expect(await result).toEqual({ entries: [] });
  expect(transport.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(['rss.qiaomu.ai', 'rss-edge.qiaomu.ai']);
  await api.entries();
  expect(new URL(transport.mock.calls.at(-1)![0]).hostname).toBe('rss-edge.qiaomu.ai');
});

it('a hung article uses one alternate after 6 seconds and ignores the late original', async () => {
  vi.useFakeTimers();
  let release: (value: { status: number; text: string }) => void = () => {};
  const transport = vi.fn((url: string) => url.includes('rss-edge')
    ? Promise.resolve({ status: 200, text: '{"entry":{"id":"new"}}' })
    : new Promise<{ status: number; text: string }>(resolve => { release = resolve; }));
  const result = recoverRead('https://rss.qiaomu.ai/api/entry/test', transport, () => {});
  await vi.advanceTimersByTimeAsync(6001);
  expect((await result).text).toContain('new');
  release({ status: 200, text: '{"entry":{"id":"old"}}' });
  await vi.advanceTimersByTimeAsync(1);
  expect((await result).text).toContain('new');
  expect(transport).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not send a custom origin, private query or authoritative denial to the edge', async () => {
  vi.useFakeTimers();
  for (const url of ['https://private.example/api/entry/a', 'https://rss.qiaomu.ai/api/entry/a?assetId=private']) {
    const transport = vi.fn(async (_target: string) => { throw Error('offline'); });
    const result = recoverRead(url, transport, () => {}).catch(() => null);
    await vi.advanceTimersByTimeAsync(2001); await result;
    expect(transport.mock.calls.every(args => args[0] === url)).toBe(true);
  }
  for (const status of [401, 403, 404, 429, 503]) {
    const transport = vi.fn(async () => ({ status, text: '' }));
    expect((await recoverRead('https://rss.qiaomu.ai/api/entry/a', transport, () => {})).status).toBe(status);
    expect(transport).toHaveBeenCalledTimes(1);
  }
});
