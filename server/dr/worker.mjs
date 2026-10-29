import { siteRead, siteType, anonymousRequest, injectStatusClient } from './site.mjs';
import statusClient from './failover-client.mjs';
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const failed = status => [500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530].includes(status);
export function publicRead(request) {
  const u = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method) || request.headers.has('Authorization') || request.headers.has('Cookie')) return false;
  if (!/^\/api\/(sources|entries|sources\/[^/]+\/entries|entry\/[^/]+(?:\/(rewrite|translation))?)$/.test(u.pathname) && !/^\/media\/wechat\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/.test(u.pathname)) return false;
  return [...u.searchParams.keys()].every(k => ['source', 'category', 'limit', 'cursor', 'ready', 'optIn', 'q', 'summary'].includes(k));
}
export class SafetyGate {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.ctx.storage.get('state') || { revision: 0, pending: {}, snapshot: null };
      const op = new URL(request.url).pathname.slice(1);
      const data = request.method === 'POST' ? await request.json() : {};
      if (op === 'preview-set' || op === 'preview-status') {
        if (op === 'preview-set') {
          if (!['normal', '500', 'timeout', 'invalid-json'].includes(data.mode)) return json({error:'invalid_preview'},400);
          state.preview = { mode: data.mode, until: Date.now() + 120000 };
          await this.ctx.storage.put('state', state);
        }
        return json(state.preview?.until > Date.now() ? state.preview : {mode:'normal',until:0});
      }
      if (op === 'start') {
        if (!data.id || typeof data.id !== 'string') return json({ error: 'invalid_ticket' }, 400);
        if (!state.pending[data.id]) { state.revision++; state.pending[data.id] = Date.now(); }
      } else if (op === 'finish') { delete state.pending[data.id]; }
      else if (op === 'publish') {
        if (Object.keys(state.pending).length || data.revision !== state.revision) return json({ error: 'snapshot_invalidated' }, 409);
        if (!/^[a-z0-9-]+$/.test(data.id || '') || !Number.isFinite(data.createdAt)) return json({ error: 'invalid_snapshot' }, 400);
        state.snapshot = { id: data.id, revision: data.revision, createdAt: data.createdAt };
      } else if (!['status', 'begin'].includes(op)) return json({ error: 'not_found' }, 404);
      if (['start', 'finish', 'publish'].includes(op)) await this.ctx.storage.put('state', state);
      const idle = Object.keys(state.pending).length === 0;
      return json({ revision: state.revision, idle, ready: idle && state.snapshot?.revision === state.revision, snapshot: state.snapshot, pendingCount: Object.keys(state.pending).length, pending: state.pending });
    });
  }
}
const gate = (env, op, body) => env.SAFETY.get(env.SAFETY.idFromName('rss')).fetch(new Request('https://gate/' + op, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
export async function originJson(request, origin, secret, timeout, fetcher = fetch) {
  const u = new URL(request.url), target = new URL(u.pathname + u.search, origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = new Headers(request.headers); headers.set('X-Rss-Origin-Key', secret); headers.delete('Host');
  try {
    return await Promise.race([
      (async () => {
        const r = await fetcher(target, { method: 'GET', headers, signal: controller.signal, redirect: 'manual', cf: { cacheTtl: 0 } });
        if (r.status !== 200) return r;
        const image = u.pathname.startsWith('/media/wechat/'), site = siteRead(request);
        const validType = site ? siteType(u.pathname).test(r.headers.get('Content-Type') || '') : image ? /^image\/(png|jpeg|gif|webp)(?:;|$)/.test(r.headers.get('Content-Type') || '') : r.headers.get('Content-Type')?.includes('application/json');
        if (!validType) throw Error('invalid_content_type');
        if (Number(r.headers.get('Content-Length') || 0) > 12_000_000) throw Error('response_too_large');
        const reader = r.body.getReader(), chunks = []; let size = 0;
        try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 12_000_000) throw Error('response_too_large'); chunks.push(part.value); } }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
        const decodedHeaders = new Headers(r.headers);
        decodedHeaders.delete('Content-Length'); decodedHeaders.delete('Content-Encoding');
        if (image || site) return new Response(request.method === 'HEAD' ? null : bytes, { status: 200, headers: decodedHeaders });
        const data = JSON.parse(new TextDecoder().decode(bytes));
        const path = u.pathname;
        if (path === '/api/health' ? data.status !== 'ok' : path === '/api/sources' ? !Array.isArray(data.sources) : path.includes('/entries') ? !Array.isArray(data.entries) : path.endsWith('/rewrite') ? !('rewrite' in data) : path.endsWith('/translation') ? !('translation' in data) : !data.entry?.id) throw Error('invalid_protocol');
        return new Response(request.method === 'HEAD' ? null : bytes, { status: 200, headers: decodedHeaders });
      })(),
      new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Error('origin_timeout')), { once: true })),
    ]);
  } finally { clearTimeout(timer); }
}
// Short-lived public list replicas share traffic; private reads and explicit refreshes remain authoritative.
function preferReplica(request, env) {
  const continents = String(env.READ_REPLICA_CONTINENTS || '').split(',');
  return request.method === 'GET' && request.headers.get('X-Rss-List') === 'reader-v1'
    && /^\/api\/(entries|sources\/[^/]+\/entries)$/.test(new URL(request.url).pathname)
    && !/no-cache|no-store|max-age\s*=\s*0/i.test(request.headers.get('Cache-Control') || '')
    && !/no-cache/i.test(request.headers.get('Pragma') || '')
    && continents.includes(request.cf?.continent);
}
async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('replica_deadline')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function replicaResponse(request, env, fetcher, maxAge, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  const remaining = () => { const ms = deadline - Date.now(); if (ms <= 0) throw Error('replica_deadline'); return ms; };
  const readState = () => bounded((async () => { const r = await gate(env, 'status'); if (!r.ok) throw Error('gate_unavailable'); return r.json(); })(), remaining());
  const state = await readState();
  const age = Date.now() - state.snapshot?.createdAt;
  if (!state.ready || !state.snapshot || !Number.isFinite(age) || age < -5000 || age > maxAge) throw Error('standby_not_ready');
  const pinned = anonymousRequest(request);
  pinned.headers.set('X-Rss-Expected-Snapshot', state.snapshot.id);
  const response = await originJson(pinned, env.STANDBY_ORIGIN, env.ORIGIN_KEY, Math.min(remaining(), Number(env.STANDBY_TIMEOUT_MS || 4000)), fetcher);
  if (![200,404].includes(response.status) || response.headers.get('X-Rss-Snapshot') !== state.snapshot.id || Number(response.headers.get('X-Rss-Revision')) !== state.revision) throw Error('standby_generation_mismatch');
  if (siteRead(request) && response.headers.get('X-Rss-Frontend-Version') !== env.FRONTEND_VERSION) throw Error('standby_frontend_mismatch');
  // Recheck after the complete body: a concurrent deletion invalidates the old snapshot.
  const latest = await readState();
  if (!latest.ready || latest.revision !== state.revision || latest.snapshot?.id !== state.snapshot.id || Date.now() - state.snapshot.createdAt > maxAge) throw Error('standby_invalidated');
  const h = new Headers(response.headers); h.set('X-Rss-Origin', 'standby'); h.set('Cache-Control', 'no-store'); h.set('X-Rss-Replica-Age', String(Math.ceil(Math.max(0, Date.now() - state.snapshot.createdAt) / 1000)));
  let body = response.body;
  if (response.status === 200 && request.method === 'GET' && request.headers.get('X-Rss-List') === 'reader-v1' && /\/entries$/.test(new URL(request.url).pathname)) {
    const data = await response.json();
    data.entries = data.entries.map(({content, assets, stats, signals, rewriteReady, rewriteStatus, ...metadata}) => metadata);
    body = JSON.stringify(data); h.delete('Content-Length'); h.delete('Content-Encoding'); h.delete('ETag'); h.set('Vary', 'Accept-Encoding, X-Rss-List');
  }
  return new Response(body, {status:response.status, headers:h});
}
async function outageResponse(request, env, fetcher) {
  const deadline = Date.now() + 5000;
  for (let attempt=0;;attempt++) {
    try {return await replicaResponse(request,env,fetcher,Number(env.MAX_SNAPSHOT_AGE_MS || 86400000),Math.max(1,deadline-Date.now()));}
    catch(error) {
      // Receiver promotion precedes publication. Re-read the gate after this brief
      // generation race; a pending deletion still fails closed on the next check.
      if (attempt>=2 || deadline-Date.now()<150 || !['standby_generation_mismatch','standby_invalidated'].includes(error.message)) throw error;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
}
export async function handle(request, env, fetcher = fetch) {
  const u = new URL(request.url);
  // HTTP-01 must reach nginx's webroot rather than the application behind HTTPS.
  if (['GET','HEAD'].includes(request.method) && /^\/\.well-known\/acme-challenge\/[A-Za-z0-9_-]+$/.test(u.pathname)) {
    const target = new URL(u.pathname, env.PRIMARY_ORIGIN); target.protocol = 'http:';
    return fetcher(target, {method:request.method,redirect:'manual'});
  }
  if (u.protocol === 'http:') {u.protocol='https:';return Response.redirect(u.href,308);}
  if (u.pathname.startsWith('/__dr/')) {
    if (!env.CONTROL_KEY || request.headers.get('Authorization') !== 'Bearer ' + env.CONTROL_KEY) return json({ error: 'forbidden' }, 403);
    if (u.pathname === '/__dr/preview') {
      if (u.hostname !== 'rss-dr.qiaomu.ai' || !['GET','POST'].includes(request.method)) return json({error:'forbidden'},403);
      return gate(env, request.method === 'POST' ? 'preview-set' : 'preview-status', request.method === 'POST' ? await request.json() : undefined);
    }
    if (u.pathname === '/__dr/drill') {
      if (u.hostname !== 'rss-dr.qiaomu.ai' || request.method !== 'POST') return json({ error: 'forbidden' }, 403);
      const { path, mode } = await request.json();
      const probe = new Request(new URL(path, 'https://rss.qiaomu.ai'));
      if ((!publicRead(probe) && !siteRead(probe)) || !['500', 'timeout', 'invalid-json'].includes(mode)) return json({ error: 'invalid_drill' }, 400);
      return handle(probe, env, (target, options) => {
        if (new URL(target.url || target.href || target).origin !== env.PRIMARY_ORIGIN) return fetcher(target, options);
        if (mode === 'timeout') return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('drill_timeout')), { once: true }));
        return Promise.resolve(mode === '500' ? json({ error: 'drill' }, 500) : new Response('broken', { headers: { 'Content-Type': 'application/json' } }));
      });
    }
    if (u.pathname.startsWith('/__dr/backup/')) {
      const key = u.pathname.slice('/__dr/backup/'.length);
      if (!/^[a-zA-Z0-9._/-]+$/.test(key) || key.includes('..')) return json({ error: 'invalid_key' }, 400);
      if (request.method === 'PUT') { await env.BACKUPS.put(key, request.body); return json({ ok: true }); }
      if (request.method === 'GET') { const o = await env.BACKUPS.get(key); return o ? new Response(o.body, { headers: { 'Cache-Control': 'no-store' } }) : json({ error: 'not_found' }, 404); }
      return json({ error: 'method_not_allowed' }, 405);
    }
    if (u.pathname === '/__dr/backups') {
      const list = await env.BACKUPS.list({ prefix: 'hourly/', limit: 1000 });
      return json({ objects: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })), truncated: list.truncated });
    }
    const op=u.pathname.slice('/__dr/'.length);
    if (!['status','begin','start','finish','publish'].includes(op)) return json({error:'not_found'},404);
    return gate(env, op, request.method === 'POST' ? await request.json() : undefined);
  }
  // Failure scenarios affect only this isolated hostname and expire after two minutes.
  if (u.hostname === 'rss-dr.qiaomu.ai') {
    const preview = await (await gate(env, 'preview-status')).json();
    if (preview.mode !== 'normal') {
      const realFetch = fetcher;
      fetcher = (target, options = {}) => {
        if (new URL(target.url || target.href || target).origin !== env.PRIMARY_ORIGIN) return realFetch(target, options);
        if (preview.mode === 'timeout') return new Promise((_, reject) => (options.signal || target.signal).addEventListener('abort', () => reject(Error('preview_timeout')), {once:true}));
        return Promise.resolve(preview.mode === '500' ? json({error:'preview'},500) : new Response('broken', {headers:{'Content-Type':'application/json'}}));
      };
    }
  }
  if (u.pathname === '/__rss_failover/client.js' && ['GET','HEAD'].includes(request.method)) {
    return new Response(request.method === 'HEAD' ? null : statusClient, {headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'}});
  }
  if (u.pathname === '/__rss_failover/health' && ['GET','HEAD'].includes(request.method)) {
    let healthy = false;
    try {
      const probe = new Request(new URL('/api/health', request.url));
      healthy = (await originJson(probe, env.PRIMARY_ORIGIN, env.ORIGIN_KEY, Number(env.PRIMARY_TIMEOUT_MS || 2500), fetcher)).status === 200;
    } catch { /* Report reading availability separately from writer availability. */ }
    if (healthy) return json({mode:'primary'});
    try {
      await outageResponse(new Request(new URL('/api/sources', request.url)), env, fetcher);
      return json({mode:'read-only'});
    } catch { return json({mode:'unavailable'},503); }
  }
  const anonymous = anonymousRequest(request);
  const readable = publicRead(anonymous) || siteRead(request);
  if (!readable) {
    const target = new URL(u.pathname + u.search, env.PRIMARY_ORIGIN);
    const headers = new Headers(request.headers); headers.set('X-Rss-Origin-Key', env.ORIGIN_KEY); headers.set('X-Forwarded-Host', 'rss.qiaomu.ai');
    // Writes are attempted once. A timeout may mean the primary accepted the write;
    // never replay it on any server and never claim that it was rolled back.
    const controller = new AbortController();
    const timeout = ['GET','HEAD'].includes(request.method) ? Number(env.PRIMARY_TIMEOUT_MS || 2500) : Number(env.PRIVATE_TIMEOUT_MS || 120000);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await bounded(fetcher(new Request(target, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, signal:controller.signal, duplex: 'half', redirect: 'manual' })), timeout);
      return response;
    } catch { return json({error:'主站暂时不可用；若刚提交了操作，请恢复后核对结果。',code:'primary_unavailable'},503); }
    finally {clearTimeout(timer);}
  }
  if (publicRead(request) && preferReplica(request, env)) {
    try {
      const response = await replicaResponse(request, env, fetcher, Math.min(90000, Math.max(1, Number(env.READ_REPLICA_MAX_AGE_MS || 90000))), 1200);
      response.headers.set('X-Rss-Route', 'replica-first'); return response;
    } catch { /* A stale or slow replica must never prevent a live primary read. */ }
  }
  let primary;
  try { primary = await originJson(request, env.PRIMARY_ORIGIN, env.ORIGIN_KEY, Number(env.PRIMARY_TIMEOUT_MS || 5000), fetcher); }
  catch { primary = json({ error: 'primary_unavailable' }, 503); }
  if (!failed(primary.status)) {
    const h = new Headers(primary.headers); h.set('X-Rss-Origin', 'primary'); h.set('Cache-Control', 'no-store');
    return injectStatusClient(new Response(primary.body, { status: primary.status, headers: h }), request);
  }
  try {
    const response = await outageResponse(request, env, fetcher);
    response.headers.set('X-Rss-Route', 'failover'); return injectStatusClient(response, request);
  } catch { return json({ error: 'service_unavailable' }, 503); }
}
export async function retainBackups(env, now=Date.now()) {
  const objects=[];let cursor;
  do { const result=await env.BACKUPS.list({prefix:'hourly/',limit:1000,cursor});objects.push(...result.objects);cursor=result.truncated?result.cursor:undefined; } while(cursor);
  const manifests=objects.filter(o=>o.key.endsWith('/manifest.json')).sort((a,b)=>b.uploaded-a.uploaded);
  const keep=new Set(),days=new Set(),weeks=new Set();
  for(const item of manifests){
    const age=now-item.uploaded.getTime(),day=Math.floor(item.uploaded.getTime()/86400000),week=Math.floor(day/7);
    if(age<86400000 || !days.has(day) && days.size<14 || !weeks.has(week) && weeks.size<8)keep.add(item.key.slice(0,-'manifest.json'.length));
    days.add(day);weeks.add(week);
  }
  for(const item of objects)if(now-item.uploaded.getTime()>86400000 && ![...keep].some(prefix=>item.key.startsWith(prefix)))await env.BACKUPS.delete(item.key);
}
export default { fetch: (request, env) => handle(request, env), scheduled: (_event,env,ctx)=>ctx.waitUntil(retainBackups(env)) };
