import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, SafetyGate } from './worker.mjs';
import { siteRead } from './site.mjs';
import statusClient from './failover-client.mjs';
import vm from 'node:vm';

function setup() {
  let state;
  const object = new SafetyGate({blockConcurrencyWhile: fn=>fn(),storage:{get:async()=>structuredClone(state),put:async(_,v)=>{state=structuredClone(v);}}});
  const env = {PRIMARY_ORIGIN:'https://primary.invalid',STANDBY_ORIGIN:'https://standby.invalid',ORIGIN_KEY:'origin',CONTROL_KEY:'control',FRONTEND_VERSION:'a'.repeat(40),PRIMARY_TIMEOUT_MS:'20',PRIVATE_TIMEOUT_MS:'20',SAFETY:{idFromName:x=>x,get:()=>object}};
  const operation=(op,data)=>object.fetch(new Request('https://gate/'+op,data ? {method:'POST',body:JSON.stringify(data)} : {}));
  const publish=()=>operation('publish',{id:'s1',revision:0,createdAt:Date.now()});
  const headers={'X-Rss-Snapshot':'s1','X-Rss-Revision':'0','X-Rss-Frontend-Version':env.FRONTEND_VERSION};
  return {env,operation,publish,headers};
}
const url=(path)=>'https://rss.qiaomu.ai'+path;
test('whole-site assets and article links have an explicit allowlist',()=>{
  for (const p of ['/','/app.js','/vendor/marked.umd.js','/articles/title--abcdef12/rewrite','/assets/rewrite']) assert(siteRead(new Request(url(p))),p);
  for (const p of ['/admin','/me','/.env','/server.js','/vendor/.secret.js','/vendor/x.json','/api/health']) assert.equal(siteRead(new Request(url(p))),false,p);
});
test('served browser source executes without bundler helpers and clears notice after recovery',async()=>{
  let mode='read-only',poll,banner;
  const document={body:{appendChild:x=>{banner=x;}},documentElement:{dataset:{}},hidden:false,createElement:()=>({setAttribute(){},style:{}})};
  const window={fetch:async()=>Response.json({mode})};
  new vm.Script(statusClient).runInNewContext({window,document,URL,AbortController,location:{href:url('/'),origin:'https://rss.qiaomu.ai'},setTimeout,clearTimeout,setInterval:fn=>{poll=fn;}});
  await new Promise(setImmediate);
  assert.equal(document.documentElement.dataset.rssReadOnly,'true');assert.equal(banner.hidden,false);
  mode='primary';poll();await new Promise(setImmediate);
  assert.equal(document.documentElement.dataset.rssReadOnly,'false');assert.equal(banner.hidden,true);
});
test('certificate challenges reach HTTP nginx without origin credentials, other HTTP requests redirect',async()=>{
  const {env}=setup();let calls=0;
  const challenge=await handle(new Request('http://rss.qiaomu.ai/.well-known/acme-challenge/token'),env,async(target,options)=>{
    calls++;assert.equal(String(target),'http://primary.invalid/.well-known/acme-challenge/token');assert.equal(options.headers,undefined);return new Response('challenge');
  });
  assert.equal(await challenge.text(),'challenge');assert.equal(calls,1);
  const redirect=await handle(new Request('http://rss.qiaomu.ai/api/me'),env);
  assert.equal(redirect.status,308);assert.equal(redirect.headers.get('Location'),'https://rss.qiaomu.ai/api/me');
});
test('cold homepage, JS and favicon fail over to versioned static replica and recover on next read',async()=>{
  const {env,publish,headers}=setup();await publish();let down=true;
  for (const [path,type,body] of [['/','text/html','<html><head></head><body>Reader</body></html>'],['/app.js','application/javascript','window.reader=true'],['/favicon.svg','image/svg+xml','<svg></svg>']]) {
    const fetcher=async target=>String(target).includes('primary')&&down ? new Response('',{status:500}) : new Response(body,{headers:{...headers,'Content-Type':type}});
    const fallback=await handle(new Request(url(path)),env,fetcher);
    assert.equal(fallback.status,200);assert.equal(fallback.headers.get('X-Rss-Route'),'failover');
    const content=await fallback.text();assert(content.includes(body.includes('</head>')?'__rss_failover/client.js':body));
    down=false;const restored=await handle(new Request(url(path)),env,fetcher);
    assert.equal(restored.headers.get('X-Rss-Origin'),'primary');down=true;
  }
});
test('logged-in public reading loses all credentials only on standby, never on primary',async()=>{
  const {env,publish,headers}=setup();await publish();const calls=[];
  const r=await handle(new Request(url('/api/entries?summary=minimal&q=中文'),{headers:{Cookie:'session=secret',Authorization:'Bearer secret','X-AI-Key':'private','X-AI-Base-URL':'private'}}),env,async(target,opts)=>{
    calls.push(String(target));
    if(String(target).includes('primary')) {assert.equal(opts.headers.get('Cookie'),'session=secret');return new Response('',{status:502});}
    for (const h of ['Cookie','Authorization','X-AI-Key','X-AI-Base-URL']) assert.equal(opts.headers.get(h),null,h);
    return Response.json({entries:[]},{headers});
  });
  assert.equal(r.status,200);assert.equal(calls.length,2);
});
test('private writes are never retried, including ambiguous connection timeout',async()=>{
  for(const path of ['/api/auth/login','/api/me/entry-state','/api/entry/id/rewrite']) {
    const {env,publish}=setup();await publish();let calls=0;
    const r=await handle(new Request(url(path),{method:'POST',body:'{"private":true}'}),env,async request=>{
      calls++;assert.equal(await request.text(),'{"private":true}');
      return new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(Error('offline')),{once:true}));
    });
    assert.equal(r.status,503);assert.equal(calls,1);assert.match((await r.json()).error,/核对结果/);
  }
});
test('frontend mismatch, invalid static content, pending deletion and old snapshots fail closed',async()=>{
  for(const kind of ['wrong-version','wrong-type','pending','old']) {
    const {env,operation,headers}=setup();
    await operation('publish',{id:'s1',revision:0,createdAt:Date.now()-(kind==='old'?86400001:0)});
    if(kind==='pending') await operation('start',{id:'delete'});
    if(kind==='wrong-version') headers['X-Rss-Frontend-Version']='b'.repeat(40);
    const r=await handle(new Request(url('/app.js')),env,async target=>String(target).includes('primary')?new Response('',{status:500}):new Response('x',{headers:{...headers,'Content-Type':kind==='wrong-type'?'text/html':'application/javascript'}}));
    assert.equal(r.status,503,kind);
  }
});
test('only authenticated preview host can set a whole-site failure scenario; production unaffected',async()=>{
  const {env,publish,headers}=setup();await publish();
  const set=host=>new Request('https://'+host+'/__dr/preview',{method:'POST',headers:{Authorization:'Bearer control'},body:JSON.stringify({mode:'500'})});
  assert.equal((await handle(set('rss.qiaomu.ai'),env)).status,403);
  assert.equal((await handle(new Request('https://rss-dr.qiaomu.ai/__dr/preview',{method:'POST',body:'{}'}),env)).status,403);
  assert.equal((await handle(set('rss-dr.qiaomu.ai'),env)).status,200);
  const fetcher=async()=>new Response('<head></head><body>Reader</body>',{headers:{...headers,'Content-Type':'text/html'}});
  assert.equal((await handle(new Request('https://rss-dr.qiaomu.ai/'),env,fetcher)).headers.get('X-Rss-Route'),'failover');
  assert.equal((await handle(new Request(url('/')),env,fetcher)).headers.get('X-Rss-Origin'),'primary');
});
test('missing article on healthy snapshot returns its 404; unsafe asset selector stays primary',async()=>{
  const {env,publish,headers}=setup();await publish();let calls=0;
  const fetcher=async target=>{calls++;return String(target.url||target).includes('primary')?Response.json({}, {status:500}):Response.json({error:'not_found'},{status:404,headers});};
  assert.equal((await handle(new Request(url('/api/entry/missing')),env,fetcher)).status,404);
  calls=0;assert.equal((await handle(new Request(url('/api/entry/id?assetId=private')),env,fetcher)).status,500);assert.equal(calls,1);
});
test('a concurrent snapshot promotion is retried against the new gate generation',async()=>{
  const {env,publish,operation,headers}=setup();await publish();let copies=0;
  const r=await handle(new Request(url('/api/entries')),env,async target=>{
    if(String(target).includes('primary'))return Response.json({}, {status:500});
    copies++;
    if(copies===1) {
      await operation('publish',{id:'s2',revision:0,createdAt:Date.now()});
      return Response.json({entries:[{id:'old'}]},{headers});
    }
    return Response.json({entries:[{id:'new'}]},{headers:{...headers,'X-Rss-Snapshot':'s2'}});
  });
  assert.equal(r.status,200);assert.equal((await r.json()).entries[0].id,'new');assert.equal(copies,2);
});
test('router pins standby reads to the published snapshot instead of an unpublished current generation',async()=>{
  const {env,publish,headers}=setup();await publish();
  const r=await handle(new Request(url('/api/entries'),{headers:{'X-Rss-Expected-Snapshot':'untrusted'}}),env,async(target,options)=>{
    if(String(target).includes('primary'))return Response.json({}, {status:500});
    assert.equal(options.headers.get('X-Rss-Expected-Snapshot'),'s1');
    return Response.json({entries:[{id:'published-old'}]},{headers});
  });
  assert.equal(r.status,200);assert.equal((await r.json()).entries[0].id,'published-old');
});
