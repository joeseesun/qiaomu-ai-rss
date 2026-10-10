// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('never duplicates an unresolved slow transport', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(() => new Promise<never>(() => {}));
  const result = new RssApi('https://rss.qiaomu.ai', transport).entries().catch(() => null);
  await vi.advanceTimersByTimeAsync(19000);
  expect(transport).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1001); await result;
});
it('does not amplify overload responses', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async () => ({ status: 503, text: '', headers: { 'retry-after': '60' } }));
  const api = new RssApi('https://rss.qiaomu.ai', transport);
  const result = api.entries().catch(() => null);
  await vi.advanceTimersByTimeAsync(5000); await result;
  expect(transport).toHaveBeenCalledTimes(1);
  await api.entries('another').catch(() => null);
  expect(transport).toHaveBeenCalledTimes(1);
});
it('reserves transport slots for foreground reading and does not release hung transports at UI timeout', async () => {
  vi.useFakeTimers();
  const urls: string[] = [];
  const transport = vi.fn((url: string) => { urls.push(url); return new Promise<never>(() => {}); });
  const api = new RssApi('https://rss.qiaomu.ai', transport);
  const lists = Array.from({length:10},(_,i) => api.entries('source'+i).catch(() => null));
  expect(urls).toHaveLength(2);
  const article = api.article('chosen').catch(() => null);
  expect(urls.some(url => url.endsWith('/entry/chosen'))).toBe(true);
  expect(urls).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(20001); await Promise.all([...lists, article]);
  expect(urls).toHaveLength(4);
  const next = api.article('next').catch(() => null);
  expect(urls).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(20001); await next;
  expect(urls).toHaveLength(4); expect(vi.getTimerCount()).toBe(0);
});
it('uses a shared retry budget instead of retrying every failing source', async () => {
  vi.useFakeTimers();
  const counts = new Map<string,number>();
  const transport = vi.fn(async (url: string) => {
    counts.set(url,(counts.get(url)||0)+1);
    return counts.get(url)===1 ? {status:502,text:''} : {status:200,text:'{"entries":[]}'};
  });
  const api=new RssApi('https://rss.qiaomu.ai',transport);
  for(let i=0;i<5;i++) {
    const p=api.entries('s'+i).catch(()=>null);
    await vi.advanceTimersByTimeAsync(2001); await p;
  }
  expect([...counts.values()].filter(n=>n===2)).toHaveLength(2);
  expect(transport.mock.calls.length).toBeLessThanOrEqual(7);
});
it('waits the server Retry-After before admitting later reads', async () => {
  vi.useFakeTimers();
  const transport=vi.fn().mockResolvedValueOnce({status:429,text:'',headers:{'Retry-After':'60'}}).mockResolvedValue({status:200,text:'{"entries":[]}'});
  const api=new RssApi('https://rss.qiaomu.ai',transport);
  await api.entries().catch(()=>null);
  await vi.advanceTimersByTimeAsync(59000);
  await api.entries().catch(()=>null); expect(transport).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1001);
  await expect(api.entries()).resolves.toEqual({entries:[]}); expect(transport).toHaveBeenCalledTimes(2);
});
it('unload rejects queued work and never starts it after an active transport finishes', async () => {
  vi.useFakeTimers();
  const releases: ((r:{status:number;text:string})=>void)[]=[];
  const transport=vi.fn(()=>new Promise<{status:number;text:string}>(resolve=>releases.push(resolve)));
  const api=new RssApi('https://rss.qiaomu.ai',transport);
  const tasks=Array.from({length:8},(_,i)=>api.entries('s'+i).catch(()=>null));
  api.dispose();for(const resolve of releases)resolve({status:200,text:'{"entries":[]}'});
  await Promise.all(tasks);expect(transport).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});
it('podcast transcript reading also bypasses a saturated channel queue', async () => {
 vi.useFakeTimers();
 const transport=vi.fn((url:string)=>url.endsWith('/transcript')?Promise.resolve({status:200,text:'{"transcript":{"segments":[{"text":"Readable"}]}}'}):new Promise<never>(()=>{}));
 const api=new RssApi('https://rss.qiaomu.ai',transport);
 const lists=[api.entries('a').catch(()=>null),api.entries('b').catch(()=>null)];
 const read=await api.article('podcast',{id:'podcast',sourceId:'podscribe-sample',title:'Episode',podcastSlug:'sample',episodeSlug:'episode'});
 expect(read.bundle.entry.content).toContain('Readable');
 await vi.advanceTimersByTimeAsync(20001);await Promise.all(lists);
});
