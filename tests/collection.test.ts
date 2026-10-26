// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CollectionClient, syncCollectionTitles } from '../src/collection';
import { initialState, withServiceOrigin } from '../src/model';
import { todayLabel } from '../src/daily-note';

describe('collection protocol and calendar dates', () => {
  it('uses local calendar day at midnight, independently of article dates', () => {
    expect(todayLabel(new Date(2026, 9, 1, 0, 1))).toBe('2026-10-01');
    expect(todayLabel(new Date(2026, 8, 30, 23, 59))).toBe('2026-09-30');
  });
  it('migrates existing settings without enabling uploads and keeps pending jobs', () => {
    const state = initialState({ settings: { baseUrl: 'https://rss.qiaomu.ai' } });
    expect(state.settings.labCollection).toBe(false);
    const job = { id: 'a', url: 'https://example.com', baseUrl: state.settings.baseUrl, createdAt: 1, notified: false };
    const restored = initialState({ ...state, collectionJobs: [job] });
    expect(restored.collectionJobs[0].status).toBe('queued');
    expect(withServiceOrigin(restored, 'https://other.example.com').collectionJobs[0].baseUrl).toBe(state.settings.baseUrl);
  });
  it('sends only the clicked URL and stable job ID, with the code in a header', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 202, text: '{"status":"queued"}' });
    await new CollectionClient('https://rss.qiaomu.ai', 'invite', transport).submit('request-id', 'https://example.com/article');
    const request = transport.mock.calls[0][0];
    expect(request.url).toBe('https://rss.qiaomu.ai/api/lab/collection-jobs');
    expect(request.headers.Authorization).toBe('Bearer invite');
    expect(JSON.parse(request.body)).toEqual({ id: 'request-id', url: 'https://example.com/article' });
    expect(request.url).not.toContain('invite');
  });
  it('handles invalid codes, offline retry, missing jobs and inconsistent results', async () => {
    const transport = vi.fn();
    const client = new CollectionClient('https://rss.qiaomu.ai', 'invite', transport);
    transport.mockResolvedValueOnce({ status: 403, text: '' });
    await expect(client.submit('id', 'https://example.com')).rejects.toThrow('邀请码');
    transport.mockResolvedValueOnce({ status: 404, text: '' });
    await expect(client.status('id')).rejects.toThrow('COLLECTION_NOT_FOUND');
    transport.mockResolvedValueOnce({ status: 200, text: '{"status":"complete"}' });
    await expect(client.status('id')).rejects.toThrow();
    expect(() => client.submit('id', 'javascript:alert(1)')).toThrow();
  });
});

describe('verified collection access', () => {
  it('deletes with an administrator session and rejects revoked permissions', async () => {
    const transport = vi.fn().mockResolvedValueOnce({status:200,text:'{"ok":true,"entryId":"entry"}'}).mockResolvedValueOnce({status:403,text:''});
    const client = new CollectionClient('https://rss.qiaomu.ai','invite',transport,{id:'client-id',key:'secret'});
    await client.deleteArticle('admin-session','entry');
    const request = transport.mock.calls[0][0];
    expect(request.headers.Authorization).toBe('Bearer admin-session');
    expect(request.headers['X-Qiaomu-Client-Key']).toBeUndefined();
    expect(JSON.parse(request.body)).toEqual({entryId:'entry'});
    await expect(client.deleteArticle('revoked','entry')).rejects.toThrow('管理员');
  });
  it('persists remote Chinese titles for already notified jobs without changing notification or other services', () => {
    const state = initialState({collectionJobs:[
      {id:'job',url:'https://example.com',baseUrl:'https://rss.qiaomu.ai',title:'English title',status:'complete',entryId:'entry',createdAt:1,notified:true},
      {id:'job',url:'https://other.example.com',baseUrl:'https://other.example.com',title:'Other title',createdAt:1},
    ]});
    const jobs = [{id:'job',url:'https://example.com',title:'中文标题',originalTitle:'English title',status:'complete' as const,entryId:'entry',createdAt:1}];
    expect(syncCollectionTitles(state.collectionJobs,jobs,'https://rss.qiaomu.ai')).toBe(true);
    const restored = initialState(JSON.parse(JSON.stringify(state)));
    expect(restored.collectionJobs[0]).toMatchObject({title:'中文标题',originalTitle:'English title',notified:true,status:'complete'});
    expect(restored.collectionJobs[1].title).toBe('Other title');
    expect(syncCollectionTitles(restored.collectionJobs,jobs,'https://rss.qiaomu.ai')).toBe(false);
  });
  it('verifies without submitting and sends per-client credentials on personal lists', async () => {
    const identity = { id: 'client-id', key: 'client-secret' };
    const transport = vi.fn().mockResolvedValueOnce({status:200,text:'{"verified":true}'}).mockResolvedValueOnce({status:200,text:'{"jobs":[],"hasMore":false,"nextCursor":""}'});
    const client = new CollectionClient('https://rss.qiaomu.ai','invite',transport,identity);
    await client.verify(['legacy-job']);
    await client.list();
    expect(JSON.parse(transport.mock.calls[0][0].body)).toEqual({clientId:identity.id,clientKey:identity.key,claimIds:['legacy-job']});
    expect(transport.mock.calls[1][0].headers['X-Qiaomu-Client-Key']).toBe(identity.key);
    expect(transport.mock.calls[1][0].url).not.toContain(identity.key);
  });
  it('uses administrator session rather than invitation and never sends a client identity on administrative requests', async () => {
    const transport = vi.fn().mockResolvedValueOnce({status:200,text:'{"token":"admin-session","expiresAt":1,"name":"Admin"}'}).mockResolvedValueOnce({status:200,text:'{"jobs":[],"hasMore":false,"nextCursor":""}'});
    const client = new CollectionClient('https://rss.qiaomu.ai','invite',transport,{id:'client-id',key:'secret'});
    const session = await client.adminLogin('admin@example.com','password');
    await client.listAll(session.token);
    expect(transport.mock.calls[1][0].headers.Authorization).toBe('Bearer admin-session');
    expect(transport.mock.calls[1][0].headers['X-Qiaomu-Client-Key']).toBeUndefined();
    expect(transport.mock.calls[1][0].body).toBeUndefined();
  });
});

it('moves with admin credentials and preserves classified failures across reload', async () => {
  const transport = vi.fn().mockResolvedValueOnce({ status: 200, text: '{"ok":true,"entryId":"entry","sourceId":"target","sourceName":"Target"}' })
    .mockResolvedValueOnce({ status: 200, text: '{"status":"failed","stage":"translation","failure":"structure"}' });
  const client = new CollectionClient('https://rss.qiaomu.ai', 'invite', transport, { id: 'client', key: 'secret' });
  expect(await client.moveArticle('admin', 'entry', 'target')).toMatchObject({ sourceId: 'target' });
  const request = transport.mock.calls[0][0];
  expect(request.headers.Authorization).toBe('Bearer admin');
  expect(request.headers['X-Qiaomu-Client-Key']).toBeUndefined();
  expect(JSON.parse(request.body)).toEqual({ entryId: 'entry', sourceId: 'target' });
  const result = await client.status('job');
  expect(initialState({collectionJobs:[{id:'job',url:'https://example.com',baseUrl:'https://rss.qiaomu.ai',createdAt:1,...result}]}).collectionJobs[0]).toMatchObject({failure:'structure',stage:'translation'});
});
