// Prepared JSON cache for QMReader. No shared CDN storage: visibility is checked here.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
function dataStamp() {
  const directory = process.env.QMREADER_DATA_DIR || path.join(__dirname, '../data');
  const database = process.env.QMREADER_DB_FILE || path.join(directory, 'qmreader.sqlite');
  return [path.join(directory, 'cache.json'), path.join(directory, 'state.json'), database, database + '-wal'].map(file => {
    try { const s = fs.statSync(file, { bigint: true }); return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; }
    catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
  }).join('|');
}
function compactEntry(entry) {
  const { content, assets, stats, signals, rewriteReady, rewriteStatus, ...metadata } = entry;
  return metadata;
}
function createResponseCache({ ttlMs = 10000, max = 200, maxBytes = 32 * 1024 * 1024, stamp = dataStamp } = {}) {
  const store = new Map(), inflight = new Map(); let bytes = 0, revision = 0, lastStamp;
  const clear = () => { store.clear(); inflight.clear(); bytes = 0; revision++; };
  function current() {
    try { const value = stamp(); if (value !== lastStamp) { clear(); lastStamp = value; } }
    catch { clear(); }
    return revision;
  }
  function build(payload) {
    const raw = Buffer.from(JSON.stringify(payload));
    const gzip = raw.length > 1024 ? zlib.gzipSync(raw, { level: 6 }) : null;
    return { payload, raw, gzip, etag: `W/"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 22)}"` };
  }
  function put(key, value, generation) {
    if (current() !== generation) return value;
    // Include a conservative allowance for the retained JS object as well as raw/gzip bytes.
    const size = value.raw.length * 3 + (value.gzip?.length || 0);
    if (size > maxBytes || max < 1) return value;
    const old = store.get(key); if (old) { bytes -= old.size; store.delete(key); }
    while (store.size && (store.size >= max || bytes + size > maxBytes)) { const oldest = store.keys().next().value; bytes -= store.get(oldest).size; store.delete(oldest); }
    store.set(key, { value, size, until: Date.now() + ttlMs }); bytes += size;
    return value;
  }
  function hit(key) { const item = store.get(key); if (item && item.until > Date.now()) { store.delete(key); store.set(key, item); return item.value; } }
  function get(key, produce) { const generation = current(); return hit(key) || put(key, build(produce()), generation); }
  async function getAsync(key, produce) {
    const generation = current(), found = hit(key); if (found) return found;
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => put(key, build(await produce()), generation))().finally(() => { if (inflight.get(key) === promise) inflight.delete(key); });
    inflight.set(key, promise); return promise;
  }
  return { get, getAsync, clear, size: () => store.size };
}
function acceptsGzip(req) {
  return String(req.headers['accept-encoding'] || '').split(',').some(part => { const [name, ...params] = part.trim().toLowerCase().split(';'); return name === 'gzip' && !params.some(p => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p)); });
}
function sendCached(req, res, entry, { shared = false } = {}) {
  res.setHeader('ETag', entry.etag);
  res.setHeader('Vary', 'Accept-Encoding, Cookie, Authorization, X-Rss-List');
  res.setHeader('Cache-Control', shared ? 'no-store' : 'private, no-cache');
  if (req.headers['if-none-match'] === entry.etag) return res.status(304).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (entry.gzip && acceptsGzip(req)) {
    res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Content-Length', entry.gzip.length); return res.end(entry.gzip);
  }
  res.setHeader('Content-Length', entry.raw.length); return res.end(entry.raw);
}
module.exports = { createResponseCache, sendCached, compactEntry, dataStamp };
