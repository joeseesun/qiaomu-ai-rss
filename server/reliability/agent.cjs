'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { isolated, stopChildren } = require('./process.cjs');
const root = process.env.RSS_AGENT_DATA || '/var/lib/qiaomu-rss-fetch';
const socket = process.env.RSS_AGENT_SOCKET || '/run/qiaomu-rss-fetch/agent.sock';
const catalogFile = path.join(root, 'catalog.json');
fs.mkdirSync(path.join(root, 'results'), { recursive: true });
let catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const pending = new Map(), queue = []; let busy = false;
const attempts = new Map(); let lastSuccess = 0;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(id);
function read(id) { try { return JSON.parse(fs.readFileSync(path.join(root, 'results', id + '.json'), 'utf8')); } catch { return null; } }
function enqueue(source, priority = false) {
  if (pending.has(source.id)) return pending.get(source.id);
  const promise = new Promise((resolve, reject) => { const item = { source, resolve, reject }; if (priority) queue.unshift(item); else queue.push(item); });
  pending.set(source.id, promise);
  promise.finally(() => pending.delete(source.id)).catch(() => {});
  drain(); return promise;
}
async function drain() {
  if (busy || !queue.length) return;
  busy = true; const item = queue.shift(); attempts.set(item.source.id, Date.now());
  try {
    const result = await isolated(path.join(__dirname, 'source-child.cjs'), { source: item.source }, { timeout: Number(process.env.RSS_AGENT_TIMEOUT_MS || 60000) });
    if (result.status !== 'ok') throw Error('upstream_failed');
    require('./remote-result.cjs').validate(item.source, result);
    const file = path.join(root, 'results', item.source.id + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(result), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    lastSuccess = Date.now(); item.resolve(result);
  } catch (error) {
    console.warn('[rss-alert]', JSON.stringify({ kind: 'standby_source_failed', sourceId: item.source.id, at: Date.now() }));
    item.reject(error);
  } finally { busy = false; drain(); }
}
function tick() {
  try { const updated = JSON.parse(fs.readFileSync(catalogFile, 'utf8')); if (Array.isArray(updated)) catalog = updated; } catch { /* Keep the last valid catalog. */ }
  for (const source of catalog) {
    if (!validId(source.id) || source.manual || source.enabled === false) continue;
    const interval = source.category === 'news' ? 30 * 60000 : source.category === 'podcast' ? 6 * 3600000 : 2 * 3600000;
    const cached = read(source.id), attempted = attempts.get(source.id) || 0;
    if (cached?.status === 'ok') lastSuccess = Math.max(lastSuccess, Number(cached.fetchedAt) || 0);
    if (Date.now() - attempted < 10 * 60000 || cached && Date.now() - cached.fetchedAt < interval) continue;
    enqueue(source).catch(() => {});
  }
  fs.writeFileSync(path.join(root, 'health.json'), JSON.stringify({ at: Date.now(), lastSuccess, busy, queued: queue.length, sources: catalog.length }));
}
const server = http.createServer(async (req, res) => {
  const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method !== 'POST') return send({ ok: false, error: 'method' }, 405);
  let bytes = 0, body = '';
  req.on('data', chunk => { bytes += chunk.length; if (bytes > 64000) req.destroy(); else body += chunk; });
  req.on('end', async () => {
    try {
      const input = JSON.parse(body);
      if (input.action === 'status') return send({ ok: true, result: { at: Date.now(), lastSuccess, busy, queued: queue.length, sources: catalog.length, cached: catalog.filter(s => read(s.id)?.status === 'ok').length } });
      if (input.action !== 'fetch' || !validId(input.source?.id)) throw Error('invalid_source');
      // The restricted SSH identity can request only sources in the provisioned public catalog.
      const source = catalog.find(s => s.id === input.source.id);
      if (!source || source.enabled === false) throw Error('unknown_source');
      const cached = read(source.id);
      if (cached && Date.now() - cached.fetchedAt < 15 * 60000) return send({ ok: true, result: cached });
      send({ ok: true, result: await enqueue(source, true) });
    } catch { send({ ok: false, error: 'standby_fetch_unavailable' }, 503); }
  });
});
if (fs.existsSync(socket)) fs.unlinkSync(socket);
server.listen(socket, () => { fs.chmodSync(socket, 0o600); tick(); });
setInterval(tick, 60000);
process.once('SIGTERM', () => { stopChildren(); server.close(); process.exit(0); });
