import test from 'node:test';
import assert from 'node:assert/strict';
import { SafetyGate, handle, originJson, publicRead } from './worker.mjs';
const response = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
function environment() {
  let value;
  const object = new SafetyGate({ blockConcurrencyWhile: fn => fn(), storage: { get: async () => structuredClone(value), put: async (_, data) => { value = structuredClone(data); } } });
  return { env: { PRIMARY_ORIGIN: 'https://primary.invalid', STANDBY_ORIGIN: 'https://standby.invalid', ORIGIN_KEY: 'test', CONTROL_KEY: 'control', SAFETY: { idFromName: x => x, get: () => object } }, object };
}
const operation = (object, op, data) => object.fetch(new Request('https://gate/' + op, data ? { method: 'POST', body: JSON.stringify(data) } : {}));
test('only anonymous public reads can fail over; unsupported query/credentials/writes stay on primary', () => {
  assert(publicRead(new Request('https://rss.test/api/entries?limit=100')));
  for (const r of [new Request('https://rss.test/api/me'), new Request('https://rss.test/api/entry/x?assetId=private'), new Request('https://rss.test/api/entries', { headers: { Cookie: 'session=secret' } }), new Request('https://rss.test/api/entries', { headers: { Authorization: 'Bearer secret' } }), new Request('https://rss.test/api/entries', { method: 'POST' })]) assert.equal(publicRead(r), false);
});
test('500 switches to matching ready snapshot; 404 and 429 never retry', async () => {
  const { env, object } = environment();
  await operation(object, 'publish', { revision: 0, id: 's1', createdAt: Date.now() });
  for (const status of [500, 404, 429]) {
    let calls = 0;
    const fetcher = async u => { calls++; return String(u).includes('primary') ? response({ error: 'failed' }, status) : response({ entries: [{ id: 'a' }] }, 200, { 'X-Rss-Snapshot': 's1', 'X-Rss-Revision': '0' }); };
    const r = await handle(new Request('https://rss.test/api/entries'), env, fetcher);
    assert.equal(r.status, status === 500 ? 200 : status);
    assert.equal(calls, status === 500 ? 2 : 1);
    if (status === 500) assert.equal(r.headers.get('X-Rss-Origin'), 'standby');
  }
});
test('deletion blocks old snapshots; publish during mutation or with outdated revision fails', async () => {
  const { env, object } = environment();
  await operation(object, 'publish', { revision: 0, id: 's1', createdAt: Date.now() });
  await operation(object, 'start', { id: 'delete' });
  assert.equal((await operation(object, 'publish', { revision: 1, id: 's2', createdAt: Date.now() })).status, 409);
  await operation(object, 'finish', { id: 'delete' });
  assert.equal((await operation(object, 'publish', { revision: 0, id: 's2', createdAt: Date.now() })).status, 409);
  assert.equal((await handle(new Request('https://rss.test/api/entries'), env, async () => response({}, 500))).status, 503);
});
test('deletion overlapping fallback body invalidates its response', async () => {
  const { env, object } = environment();
  await operation(object, 'publish', { revision: 0, id: 's1', createdAt: Date.now() });
  const r = await handle(new Request('https://rss.test/api/entries'), env, async u => {
    if (String(u).includes('primary')) return response({}, 500);
    await operation(object, 'start', { id: 'delete' });
    return response({ entries: [{ id: 'deleted' }] }, 200, { 'X-Rss-Snapshot': 's1', 'X-Rss-Revision': '0' });
  });
  assert.equal(r.status, 503);
});
test('snapshot mismatch fails closed; body reads are bounded by timeout', async () => {
  const { env, object } = environment();
  await operation(object, 'publish', { revision: 0, id: 's1', createdAt: Date.now() });
  assert.equal((await handle(new Request('https://rss.test/api/entries'), env, async u => String(u).includes('primary') ? response({}, 500) : response({ entries: [] }, 200, { 'X-Rss-Snapshot': 'wrong', 'X-Rss-Revision': '0' }))).status, 503);
  await assert.rejects(originJson(new Request('https://rss.test/api/entries'), 'https://primary.invalid', 'test', 10, async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } })), /timeout/);
});
test('Cookie and POST bodies are forwarded once without standby retry', async () => {
  const { env } = environment(); let calls = 0;
  const r = await handle(new Request('https://rss.test/api/login', { method: 'POST', headers: { Cookie: 'session=x' }, body: 'credentials' }), env, async request => {
    calls++; assert.equal(await request.text(), 'credentials'); assert.equal(request.headers.get('Cookie'), 'session=x'); return response({}, 500);
  });
  assert.equal(r.status, 500); assert.equal(calls, 1);
});
test('unauthorized or production-domain drills cannot inject failures',async()=>{
 const {env}=environment();
 for(const [host,authorization] of [['rss-dr.qiaomu.ai','wrong'],['rss.qiaomu.ai','Bearer control']])assert.equal((await handle(new Request('https://'+host+'/__dr/drill',{method:'POST',headers:{Authorization:authorization},body:JSON.stringify({path:'/api/entries',mode:'500'})}),env)).status,403);
});
test('retention preserves latest daily and weekly backups and removes old partials',async()=>{
 const {retainBackups}=await import('./worker.mjs');const now=Date.now(),deleted=[];
 const objects=Array.from({length:100},(_,i)=>({key:'hourly/s'+i+'/manifest.json',uploaded:new Date(now-i*86400000),size:1}));
 objects.push({key:'hourly/partial/part.enc',uploaded:new Date(now-2*86400000),size:1});
 await retainBackups({BACKUPS:{list:async()=>({objects,truncated:false}),delete:async key=>deleted.push(key)}},now);
 assert(!deleted.includes('hourly/s0/manifest.json'));assert(!deleted.includes('hourly/s13/manifest.json'));assert(deleted.includes('hourly/s99/manifest.json'));assert(deleted.includes('hourly/partial/part.enc'));
});
test('fresh Asian compact list reads use standby without touching primary',async()=>{
 const {env,object}=environment();env.READ_REPLICA_CONTINENTS='AS,OC';env.READ_REPLICA_MAX_AGE_MS='90000';
 await operation(object,'publish',{revision:0,id:'s1',createdAt:Date.now()});
 const request=new Request('https://rss.test/api/entries?limit=40',{headers:{'X-Rss-List':'reader-v1'}});Object.defineProperty(request,'cf',{value:{continent:'AS'}});
 const calls=[];const result=await handle(request,env,async u=>{calls.push(String(u));return response({entries:[{id:'a'}]},200,{'X-Rss-Snapshot':'s1','X-Rss-Revision':'0'});});
 assert.equal(result.headers.get('X-Rss-Origin'),'standby');assert.equal(calls.length,1);assert.match(calls[0],/standby/);assert.ok(Number(result.headers.get('X-Rss-Replica-Age'))>=0);
});
test('replica-first never serves stale, mutated, personalized, or explicit refresh requests',async()=>{
 for(const kind of ['stale','pending','cookie','refresh','wrong-snapshot']){
 const {env,object}=environment();env.READ_REPLICA_CONTINENTS='AS,OC';env.READ_REPLICA_MAX_AGE_MS='90000';
 await operation(object,'publish',{revision:0,id:'s1',createdAt:Date.now()-(kind==='stale'?100000:0)});
 if(kind==='pending')await operation(object,'start',{id:'mutation'});
 const headers={'X-Rss-List':'reader-v1'};if(kind==='cookie')headers.Cookie='session=x';if(kind==='refresh')headers['Cache-Control']='no-cache';
 const request=new Request('https://rss.test/api/entries',{headers});Object.defineProperty(request,'cf',{value:{continent:'AS'}});
 let primary=0;const result=await handle(request,env,async u=>{if(String(u.url||u).includes('primary')){primary++;return response({entries:[{id:'primary'}]});}return response({entries:[{id:'replica'}]},200,{'X-Rss-Snapshot':'wrong','X-Rss-Revision':'0'});});
 assert.equal((await result.json()).entries[0].id,'primary',kind);assert.equal(primary,1,kind);
 }
});
test('replica preference has a bounded wait and rechecks concurrent deletion',async()=>{
 for(const kind of ['slow','deletion']){
  const {env,object}=environment();env.READ_REPLICA_CONTINENTS='AS';
  await operation(object,'publish',{revision:0,id:'s1',createdAt:Date.now()});
  const request=new Request('https://rss.test/api/entries',{headers:{'X-Rss-List':'reader-v1'}});Object.defineProperty(request,'cf',{value:{continent:'AS'}});
  let primary=0;const started=Date.now();
  const result=await handle(request,env,async(u,options)=>{
   if(String(u).includes('primary')){primary++;return response({entries:[{id:'current'}]});}
   if(kind==='slow')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}));
   await operation(object,'start',{id:'delete'});
   return response({entries:[{id:'removed'}]},200,{'X-Rss-Snapshot':'s1','X-Rss-Revision':'0'});
  });
  assert.equal((await result.json()).entries[0].id,'current');assert.equal(primary,1);assert.ok(Date.now()-started<2000);
 }
});
