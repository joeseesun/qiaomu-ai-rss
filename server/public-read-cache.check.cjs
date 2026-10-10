const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { middleware } = require('./public-read-cache.cjs');
function fixture(options = {}) {
  let stamp = 'one', time = 0, calls = 0, value = { entries: [{ id: 'visible', content: 'body' }] };
  const cache = middleware({ stamp: () => stamp, now: () => time, ...options });
  function request(url = '/api/entries?limit=100', method = 'GET', headers = {}, respond = true) {
    const req = { url, path: url.split('?')[0], method, headers };
    const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, body: null,
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, getHeader(name) { return this.headers[name.toLowerCase()]; },
      send(body) { this.body = typeof body === 'string' ? JSON.parse(body) : body; this.emit('finish'); return this; },
      json(body) { return this.send(body); },
    });
    cache(req, res, () => { calls++; if (respond) res.json(value); }); return res;
  }
  return { cache, request, calls: () => calls, change: () => { stamp += '!'; value = { entries: [] }; }, time: n => { time = n; }, value: v => { value = v; } };
}
test('100 anonymous identical reads execute the origin handler once', () => {
  const f = fixture(); for (let i=0;i<100;i++) assert.equal(f.request().body.entries[0].id, 'visible');
  assert.equal(f.calls(),1); assert.equal(f.cache.stats().hits,99);
});
test('data changes and TTL invalidate responses; query variants stay isolated', () => {
  const f=fixture(); f.request(); f.request('/api/entries?limit=40'); assert.equal(f.calls(),2);
  f.change(); assert.deepEqual(f.request().body,{entries:[]}); assert.equal(f.calls(),3);
  f.time(10001); f.request(); assert.equal(f.calls(),4);
});
test('writes invalidate immediately, bypass cache while active and clear again on close', () => {
  const f=fixture(); f.request(); const write=f.request('/api/entry/visible','DELETE',{},false);
  f.value({entries:[]}); assert.deepEqual(f.request().body,{entries:[]}); write.emit('close');
  assert.deepEqual(f.request().body,{entries:[]}); assert.equal(f.calls(),4);
});
test('late reads cannot repopulate a generation invalidated by deletion', () => {
  const f=fixture(); const old=f.request('/api/entries','GET',{},false);
  f.request('/api/entry/visible','DELETE'); old.json({entries:[{id:'deleted'}]});
  f.value({entries:[]}); assert.deepEqual(f.request('/api/entries').body,{entries:[]}); assert.equal(f.calls(),3);
});
test('credentials, nonpublic paths and unknown query parameters always bypass', () => {
  const f=fixture();
  for(const [url,headers] of [['/api/entries',{cookie:''}],['/api/entries',{authorization:'x'}],['/api/me',{}],['/api/entries?private=1',{}]]) { f.request(url,'GET',headers); f.request(url,'GET',headers); }
  assert.equal(f.calls(),8); assert.equal(f.cache.stats().entries,0);
});
test('failures and cookie-bearing responses never enter the cache', () => {
  const f=fixture();
  let res=f.request('/api/entries','GET',{},false); res.statusCode=503; res.json({error:'busy'});
  res=f.request('/api/entries','GET',{},false); res.setHeader('Set-Cookie','private'); res.json({entries:[]});
  assert.equal(f.cache.stats().entries,0);
});
test('bounds entries and bytes; filesystem failure safely bypasses caching', () => {
  const f=fixture({maxEntries:2,maxBytes:150}); for(let i=0;i<10;i++) f.request('/api/entries?cursor='+i);
  assert(f.cache.stats().entries<=2); assert(f.cache.stats().bytes<=150);
  const broken=fixture({stamp:()=>{throw Error('unreadable')}}); broken.request(); broken.request(); assert.equal(broken.calls(),2);
});
test('reader list negotiation strips unused heavy fields without changing legacy or detail responses', () => {
  const f=fixture(); const entry={id:'one',title:'Title',summary:'Keep',content:'Full body',rewrite:{body:'Keep rewrite'},assets:{large:'x'.repeat(20000)},stats:{views:1},signals:[1]};
  f.value({entries:[entry],hasMore:true,nextCursor:'next'});
  const lean=f.request('/api/entries?limit=100','GET',{'x-rss-list':'reader-v1'}).body;
  assert.equal(lean.entries[0].assets,undefined); assert.equal(lean.entries[0].content,undefined);
  assert.equal(lean.entries[0].summary,'Keep'); assert.deepEqual(lean.entries[0].rewrite,entry.rewrite); assert.equal(lean.nextCursor,'next');
  assert.deepEqual(f.request().body.entries[0],entry);
  assert.equal(f.request('/api/entries?limit=100','GET',{'x-rss-list':'reader-v1'}).headers['x-rss-read-cache'],'hit');
});
