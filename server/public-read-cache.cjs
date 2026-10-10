// Copyright (c) 2026 Qiaomu. MIT licensed integration module.
// Anonymous reads only. Mount after compression/security headers, before session lookup/routes.
const fs = require('node:fs');
const path = require('node:path');
function dataStamp(directory) {
  const database = process.env.QMREADER_DB_FILE || path.join(directory, 'qmreader.sqlite');
  return [path.join(directory, 'cache.json'), path.join(directory, 'state.json'), database, database + '-wal'].map(name => {
    try { const s = fs.statSync(name, { bigint: true }); return `${name}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; }
    catch (error) { if (error.code === 'ENOENT') return `${name}:missing`; throw error; }
  }).join('|');
}
function publicKey(req) {
  if (req.method !== 'GET' || req.headers.authorization !== undefined || req.headers.cookie !== undefined || req.user) return null;
  const u = new URL(req.originalUrl || req.url, 'http://local');
  if (!/^\/api\/(sources|entries|sources\/[^/]+\/entries|entry\/[^/]+(?:\/(rewrite|translation))?)$/.test(u.pathname)) return null;
  if ([...u.searchParams.keys()].some(key => !['source','category','limit','cursor','ready','optIn'].includes(key))) return null;
  if (u.search.length > 2048) return null;
  u.searchParams.sort(); return u.pathname + u.search + (req.headers['x-rss-list'] === 'reader-v1' ? '|reader-v1' : '');
}
function middleware({ directory, stamp = () => dataStamp(directory), now = Date.now, ttl = 10_000, maxBytes = 32 * 1024 * 1024, maxEntries = 128 } = {}) {
  const cache = new Map(); let bytes = 0, revision = 0, activeWrites = 0, lastStamp;
  const stats = { hits: 0, misses: 0, invalidations: 0 };
  const invalidate = () => { cache.clear(); bytes = 0; revision++; stats.invalidations++; };
  const current = () => { const value = stamp(); if (value !== lastStamp) { invalidate(); lastStamp = value; } return value; };
  const handler = (req, res, next) => {
    if (req.path.startsWith('/api/') && !['GET','HEAD','OPTIONS'].includes(req.method)) {
      invalidate(); activeWrites++;
      let done = false;
      const finish = () => { if (done) return; done = true; activeWrites--; invalidate(); };
      res.once('finish', finish); res.once('close', finish);
      return next();
    }
    const key = publicKey(req);
    if (!key || activeWrites) return next();
    const vary = String(res.getHeader('Vary') || '');
    res.setHeader('Vary', vary ? vary + ', X-Rss-List' : 'X-Rss-List');
    let before;
    try { before = current(); } catch { invalidate(); return next(); }
    const generation = revision, hit = cache.get(key);
    if (hit && hit.expires > now()) {
      stats.hits++;
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Rss-Read-Cache', 'hit');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(hit.body);
    }
    stats.misses++;
    const compact = req.headers['x-rss-list'] === 'reader-v1' && /\/entries$/.test(req.path);
    const original = res.json;
    res.json = function(body) {
      res.json = original;
      if (compact && Array.isArray(body?.entries)) body = { ...body, entries: body.entries.map(entry => {
        const { content, assets, stats, signals, rewriteReady, rewriteStatus, ...metadata } = entry;
        return metadata;
      }) };
      res.setHeader('X-Rss-Read-Cache', 'miss');
      try {
        const policy = String(res.getHeader('Cache-Control') || '');
        const eligible = res.statusCode === 200 && !res.getHeader('Set-Cookie') && !/private/i.test(policy) && !activeWrites && current() === before && revision === generation;
        if (eligible) {
          const text = JSON.stringify(body), size = Buffer.byteLength(text);
          // Do not retain unusually large individual articles or unbounded cursor variants.
          if (size <= Math.min(maxBytes, 2 * 1024 * 1024)) {
            const old = cache.get(key); if (old) { bytes -= old.size; cache.delete(key); }
            for (const [other, value] of cache) {
              if (cache.size < maxEntries && bytes + size <= maxBytes) break;
              cache.delete(other); bytes -= value.size;
            }
            cache.set(key, { body: text, size, expires: now() + ttl }); bytes += size;
          }
        }
      } catch { invalidate(); /* Cache errors must never prevent the authoritative response. */ }
      // No browser/CDN storage: all reads still cross visibility/invalidation checks here.
      res.setHeader('Cache-Control', 'no-store');
      return original.call(this, body);
    };
    next();
  };
  handler.stats = () => ({ ...stats, entries: cache.size, bytes });
  return handler;
}
module.exports = { middleware, publicKey, dataStamp };
