// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { discoverFeedUrls, isSourceInput, resolveDocument, resolveSource } from '../src/feed-resolver';
import { initialState } from '../src/model';
import { Subscriptions } from '../src/subscriptions';
import { t } from '../src/i18n';
import type { ImportDocument } from '../src/import-source';
beforeAll(() => Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }));
const rss = '<rss><channel><title>Lex</title><item><guid>one</guid><title>Article</title></item></channel></rss>';
const opml = '<opml><body><outline text="Podcasts"><outline text="Lex" xmlUrl="https://example.com/rss"/><outline xmlUrl="https://example.com/rss"/><outline xmlUrl="javascript:bad"/></outline></body></opml>';
const reader = (pages: Record<string,string>) => vi.fn(async (url: string): Promise<ImportDocument> => { if (!(url in pages)) throw Error('offline'); return {url,text:pages[url]}; });
describe('subscription resolution by content', () => {
  it('accepts RSS, Atom and OPML without relying on extensions or MIME', async () => {
    const read=reader({'https://example.com/no-extension':rss,'https://example.com/feed.xml':opml});
    expect((await resolveSource('example.com/no-extension',document,undefined,read)).kind).toBe('feed');
    const list=await resolveSource('https://example.com/feed.xml',document,undefined,read);
    expect(list).toMatchObject({kind:'opml',skipped:2,feeds:[{name:'Lex',group:'Podcasts'}]});
    expect((await resolveDocument('<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>','https://example.com/atom',document)).kind).toBe('feed');
  });
  it('rejects arbitrary XML, malformed XML, DTD, dangerous URLs and oversize input', async () => {
    await expect(resolveDocument('<urlset/>','https://example.com',document)).rejects.toThrow(t('source.unsupported'));
    await expect(resolveDocument('<rss>','https://example.com',document)).rejects.toThrow();
    await expect(resolveDocument('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss,'https://example.com',document)).rejects.toThrow();
    await expect(resolveDocument(' '.repeat(5*1024*1024)+rss,'https://example.com',document)).rejects.toThrow();
    const read=reader({});await expect(resolveSource('https://user:pass@example.com',document,undefined,read)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
  });
  it('does not treat a local feed without an online self address as a subscription', async () => {
    await expect(resolveDocument(rss,undefined,document)).rejects.toThrow(t('source.needOnlineUrl'));
  });
  it('only discovers safe head alternate links and bounds and deduplicates candidates', () => {
    const html='<!doctype html><html><head><base href="https://example.com/blog/"><link rel="alternate" type="application/rss+xml" href="feed.xml"><link rel="alternate" type="application/rss+xml" href="feed.xml"><link rel="alternate" type="text/html" href="/other"><link rel="alternate" type="application/rss+xml" href="javascript:bad"></head><body><a href="/rss">RSS</a></body></html>';
    expect(discoverFeedUrls(html,document)).toEqual(['https://example.com/blog/feed.xml']);
    expect(discoverFeedUrls('<html><head><link rel="alternate" type="application/atom+xml" href="/feed"></head></html>',document)).toEqual([]);
    expect(discoverFeedUrls('<html><head><link rel="alternate" type="application/atom+xml" href="/feed"></head></html>',document,'https://final.example/blog')).toEqual(['https://final.example/feed']);
    const many='<html><head>'+Array.from({length:20},(_,i)=>`<link rel="alternate" type="application/rss+xml" href="https://example.com/${i}">`).join('')+'</head></html>';
    expect(discoverFeedUrls(many,document)).toHaveLength(8);
  });
  it('validates candidates, directly adds only an unambiguous single result, reports partial failure', async () => {
    const head=(urls:string[])=>'<html><head>'+urls.map(url=>`<link rel="alternate" type="application/rss+xml" href="${url}">`).join('')+'</head></html>';
    const read=reader({'https://example.com/':head(['https://example.com/rss']), 'https://example.com/rss':rss});
    expect((await resolveSource('https://example.com',document,undefined,read)).kind).toBe('feed');
    const partial=reader({'https://example.com/':head(['https://example.com/rss','https://example.com/broken']), 'https://example.com/rss':rss});
    expect(await resolveSource('https://example.com',document,undefined,partial)).toMatchObject({kind:'candidates',failed:1,feeds:[{url:'https://example.com/rss'}]});
  });
  it('drops a response when the user has changed input', async () => {
    let active=true;
    const read=vi.fn(async(url:string)=>{active=false;return {url,text:rss};});
    await expect(resolveSource('https://example.com',document,()=>active,read)).rejects.toThrow(t('source.cancelled'));
  });
  it('recognizes names separately without transmitting them as URLs',()=>{
    expect(isSourceInput('阮一峰')).toBe(false);expect(isSourceInput('example.com/feed.xml')).toBe(true);expect(isSourceInput('https://private.example/?token=x')).toBe(true);
  });
});
describe('commit and undo verified sources',()=>{
  it('invalidates body persistence before saving an added feed, but not a rejected duplicate',async()=>{
    const state=initialState(null), writes:string[]=[], service=new Subscriptions(()=>state,async()=>{writes.push('save');},undefined,()=>{writes.push('bodies');});
    const resolved=await resolveDocument(rss,'https://example.com/rss',document);if(resolved.kind!=='feed')throw Error('fixture');
    await service.addResolved(resolved);expect(writes).toEqual(['bodies','save']);
    await expect(service.addResolved(resolved)).rejects.toThrow();expect(writes).toEqual(['bodies','save']);
  });
  it('uses the parsed result without a second download and rejects concurrent duplicates',async()=>{
    const state=initialState(null), transport=vi.fn(), service=new Subscriptions(()=>state,async()=>{},transport);
    const resolved=await resolveDocument(rss,'https://example.com/rss',document);if(resolved.kind!=='feed')throw Error('fixture');
    const result=await Promise.allSettled([service.addResolved(resolved),service.addResolved(resolved)]);
    expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(state.subscriptions).toHaveLength(1);expect(transport).not.toHaveBeenCalled();
  });
  it('does not commit stale input and rolls back failed saves',async()=>{
    const state=initialState(null), service=new Subscriptions(()=>state,async()=>{throw Error('disk full');});
    const resolved=await resolveDocument(rss,'https://example.com/rss',document);if(resolved.kind!=='feed')throw Error('fixture');
    await expect(service.addResolved(resolved,'',()=>false)).rejects.toThrow();expect(state.subscriptions).toHaveLength(0);
    await expect(service.addResolved(resolved)).rejects.toThrow('disk full');expect(state.subscriptions).toHaveLength(0);expect(Object.keys(state.sourceMeta)).toHaveLength(0);
  });
  it('preserves existing feeds, nested groups, favorites and subsequently edited additions on undo',async()=>{
    const state=initialState(null), service=new Subscriptions(()=>state,async()=>{});
    await service.import([{url:'https://existing.example/',name:'Original',group:'Original group'}]);
    const additions=await service.importAdded([{url:'https://existing.example/',name:'Changed',group:'Wrong'},{url:'https://new.example/a',name:'A',group:'Parent / Child'},{url:'https://new.example/b',name:'B',group:'Parent / Child'}]);
    const receipt=service.receipt(additions);expect(additions).toHaveLength(2);expect(state.subscriptions[0].name).toBe('Original');
    await service.edit(additions[1].id,'Edited','Other');
    state.favorites.saved={entry:{id:'saved',sourceId:additions[0].id,title:'Keep'},rewrite:null,translation:null,fetchedAt:1};
    expect(await service.undoAdded(receipt)).toBe(1);expect(state.subscriptions.map(f=>f.name)).toEqual(['Original','Edited']);expect(state.favorites.saved.entry.title).toBe('Keep');
  });
});
