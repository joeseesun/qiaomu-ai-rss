// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
const ok = (value: unknown) => ({ status: 200, text: JSON.stringify(value) });
afterEach(() => vi.useRealTimers());

describe('bounded recovery for shared reads', () => {
  it('shares a slow read without a speculative second request', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(() => new Promise<never>(() => {}));
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    const result = Promise.allSettled([api.sources(), api.sources()]);
    await vi.advanceTimersByTimeAsync(8001);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(12000);
    expect((await result).every(value => value.status === 'rejected')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('accepts a slow first response without duplicating work', async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(ok({ sources: [{ id: 'one', name: 'One' }] })), 9000))).mockImplementation(() => new Promise(() => {}));
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    const result = api.sources();
    await vi.advanceTimersByTimeAsync(9001);
    await expect(result).resolves.toMatchObject({ sources: [{ id: 'one' }] });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([502, 504])('recovers HTTP %i once', async status => {
    vi.useFakeTimers();
    const transport = vi.fn().mockResolvedValueOnce({ status, text: '' }).mockResolvedValue(ok({ entries: [] }));
    const result = new RssApi('https://rss.qiaomu.ai', transport).entries();
    // Attach before advancing timers so the old failure is not unhandled.
    const observed = result.then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(2001);
    expect(await observed).toEqual({ value: { entries: [] } });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('recovers a connection failure once', async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET')).mockResolvedValue(ok({ entries: [] }));
    const observed = new RssApi('https://rss.qiaomu.ai', transport).entries().then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(2001);
    expect(await observed).toEqual({ value: { entries: [] } });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 404, 429, 503])('does not retry terminal HTTP %i', async status => {
    const transport = vi.fn(async () => ({ status, text: '' }));
    await expect(new RssApi('https://rss.qiaomu.ai', transport).entries()).rejects.toThrow(`HTTP ${status}`);
    expect(transport).toHaveBeenCalledOnce();
  });
  it('retains the total 20 second deadline and releases the shared request', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(() => new Promise<never>(() => {}));
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    const observed = api.entries().catch(error => error.message);
    await vi.advanceTimersByTimeAsync(20001);
    expect(await observed).toContain('请求超时');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    transport.mockResolvedValueOnce(ok({ entries: [] }) as never);
    await expect(api.entries()).resolves.toEqual({ entries: [] });
  });
  it('does not retry invalid JSON or schema failures', async () => {
    for (const text of ['invalid JSON', '{"entries":[{}]}']) {
      const transport = vi.fn(async () => ({ status: 200, text }));
      await expect(new RssApi('https://rss.qiaomu.ai', transport).entries()).rejects.toThrow();
      expect(transport).toHaveBeenCalledOnce();
    }
  });
});

describe('late transport isolation and diagnostics', () => {
  it('does not let a late timed-out response clear or resolve a newer shared operation', async () => {
    vi.useFakeTimers();
    const releases: ((value: { status: number; text: string }) => void)[] = [];
    const transport = vi.fn(() => new Promise<{ status: number; text: string }>(resolve => releases.push(resolve)));
    const api = new RssApi('https://rss.qiaomu.ai', transport);
    const old = api.entries().catch(error => error.message);
    await vi.advanceTimersByTimeAsync(20001);
    expect(await old).toContain('请求超时');
    const current = api.entries();
    releases[0](ok({ entries: [{ id: 'old', sourceId: 'source', title: 'Old' }] }));
    await vi.advanceTimersByTimeAsync(1);
    const shared = api.entries();
    expect(transport).toHaveBeenCalledTimes(2);
    releases[1](ok({ entries: [] }));
    expect(await current).toEqual({ entries: [] });
    expect(await shared).toEqual({ entries: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps bounded, isolated diagnostics without query values or response bodies', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async () => ok({ entries: [] }));
    for (let i = 0; i < 65; i++) await api.entries('', `private-cursor-${i}`);
    const events = api.readDiagnostics();
    expect(events).toHaveLength(60);
    expect(JSON.stringify(events)).not.toContain('private-cursor');
    expect(events.at(-1)).toMatchObject({ path: '/api/entries', attempt: 1, kind: 'response', status: 200 });
    events[0].path = 'mutated';
    expect(api.readDiagnostics()[0].path).toBe('/api/entries');
  });
});
