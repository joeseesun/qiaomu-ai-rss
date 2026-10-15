// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { initialState, subscriptionSchema } from '../src/model';
import { Subscriptions, refreshIntervalMs } from '../src/subscriptions';
beforeAll(() => { Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); });
const xml = '<rss><channel><title>Feed</title><item><guid>new</guid><title>New</title></item></channel></rss>';
describe('large subscription libraries', () => {
  it('evicts rebuildable bodies without losing article metadata or saved bodies', async () => {
    const state = initialState(null);
    for (let i = 0; i < 24; i++) state.subscriptions.push(subscriptionSchema.parse({ name: 'Feed', id: `f${i}`, url: `https://example.com/${i}`, entries: [{ id: `e${i}`, sourceId: `f${i}`, title: `Article ${i}`, content: 'x'.repeat(1024 * 1024) }], updatedAt: i + 1 }));
    state.favorites.e0 = { entry: state.subscriptions[0].entries[0], rewrite: null, translation: null, fetchedAt: 1 };
    const service = new Subscriptions(() => state, async () => {}, async () => ({ status: 200, text: xml }));
    await service.refresh(['f23'], document, true);
    expect(state.subscriptions.slice(0, 23).every(feed => feed.entries.length === 1)).toBe(true);
    expect(state.subscriptions.some(feed => !feed.entries[0]?.content)).toBe(true);
    expect(state.favorites.e0.entry.content).toHaveLength(1024 * 1024);
  });
  it('persists successful unchanged checks and clears previous failure backoff', async () => {
    const state = initialState(null), persist = vi.fn(async () => {});
    state.subscriptions.push(subscriptionSchema.parse({ name: 'Feed', id: 'f', url: 'https://example.com/rss', etag: 'v1', updatedAt: 1, errorCount: 2, lastErrorAt: 1 }));
    const service = new Subscriptions(() => state, persist, async () => ({ status: 304, text: '' }));
    await service.refresh(['f'], document);
    expect(state.subscriptions[0].errorCount).toBe(0);
    expect(persist).toHaveBeenCalledOnce();
  });
  it('uses validators on manual refresh when a cached body is available', async () => {
    const state = initialState(null), transport = vi.fn(async () => ({ status: 304, text: '' }));
    state.subscriptions.push(subscriptionSchema.parse({ name: 'Feed', id: 'f', url: 'https://example.com/rss', etag: 'v1', entries: [{ id: 'a', sourceId: 'f', title: 'A', content: 'Body' }] }));
    await new Subscriptions(() => state, async () => {}, transport).refresh(['f'], document, true);
    expect(transport.mock.calls[0]).toEqual(['https://example.com/rss', { 'If-None-Match': 'v1' }]);
  });
});

it('adapts polling to source cadence within bounded intervals', () => {
  const feed = subscriptionSchema.parse({ id:'f',name:'Feed',url:'https://example.com',entries:[{id:'a',sourceId:'f',title:'A',publishedTs:86400000},{id:'b',sourceId:'f',title:'B',publishedTs:0}] });
  expect(refreshIntervalMs(feed)).toBe(3600000); feed.entries[0].publishedTs=60000;expect(refreshIntervalMs(feed)).toBe(300000);
});
it('does not start queued subscription transports after leaving the channel', async () => {
  const state=initialState(null);for(let i=0;i<8;i++)state.subscriptions.push(subscriptionSchema.parse({id:String(i),name:'Feed',url:`https://example.com/${i}`}));
  let active=true;const release: (()=>void)[]=[];const transport=vi.fn(()=>new Promise<{status:number;text:string}>(resolve=>release.push(()=>resolve({status:304,text:''}))));
  const service=new Subscriptions(()=>state,async()=>{},transport);
  const refresh=service.refresh(state.subscriptions.map(feed=>feed.id),document,false,undefined,()=>active);
  await new Promise(resolve=>setTimeout(resolve,0));expect(transport).toHaveBeenCalledTimes(2);active=false;release.forEach(done=>done());await refresh;
  expect(transport).toHaveBeenCalledTimes(2);expect(state.subscriptions.every(feed=>!feed.error)).toBe(true);
});
