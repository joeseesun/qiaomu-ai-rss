// Private input fingerprints. This file and its state never go to the standby.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const encode = value => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? String(v) : v);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function fileHash(file) { return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null; }
function treeHash(dir) {
  if (!fs.existsSync(dir)) return null;
  return hash(encode(fs.readdirSync(dir).sort().map(name => {
    const file = path.join(dir, name);
    return [name, fs.statSync(file).isDirectory() ? treeHash(file) : fileHash(file)];
  })));
}
function fingerprints({ dbFile, dataDir, app, noteDirs = [], env = process.env }) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const perEntry = new Map(), global = [];
  const add = (id, table, row) => {
    if (!perEntry.has(id)) perEntry.set(id, crypto.createHash('sha256'));
    perEntry.get(id).update(encode([table, row]) + '\n');
  };
  const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  global.push(tables);
  // These tables are not read by the anonymous projection. All unknown tables
  // invalidate globally; all entry_id tables (including future ones) are tracked.
  const unrelated = new Set(['sessions', 'ai_oauth_accounts', 'api_tokens', 'notifications', 'user_follows', 'submission_requests', 'refresh_jobs']);
  const indirect = {
    comment_reactions: ['comment_id', 'commentaries'],
    chat_reactions: ['message_id', 'chat_messages'],
    text_annotation_reactions: ['annotation_id', 'text_annotations'],
    text_annotation_replies: ['annotation_id', 'text_annotations'],
  };
  try {
    for (const { name, sql } of tables) {
      if (unrelated.has(name)) continue;
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
      const key = name === 'entries' ? 'id' : columns.some(c => c.name === 'entry_id') ? 'entry_id' : null;
      const pk = columns.filter(c => c.pk).sort((a,b) => a.pk-b.pk).map(c => quote(c.name));
      const order = pk.length ? pk.join(',') : 'rowid';
      const select = /WITHOUT\s+ROWID/i.test(sql) ? '*' : 'rowid AS __rss_rowid,*';
      if (key) {
        for (const row of db.prepare(`SELECT ${select} FROM ${quote(name)} ORDER BY ${order}`).iterate()) add(row[key], name, row);
      } else if (indirect[name]) {
        const [foreignKey, parent] = indirect[name];
        const ids = new Map(db.prepare(`SELECT id,entry_id FROM ${quote(parent)}`).all().map(r => [r.id,r.entry_id]));
        for (const row of db.prepare(`SELECT ${select} FROM ${quote(name)} ORDER BY ${order}`).iterate()) {
          if (ids.has(row[foreignKey])) add(ids.get(row[foreignKey]), name, row);
        }
      } else {
        const digest = crypto.createHash('sha256');
        for (const row of db.prepare(`SELECT ${select} FROM ${quote(name)} ORDER BY ${order}`).iterate()) digest.update(encode(row)+'\n');
        global.push([name,digest.digest('hex')]);
      }
    }
  } finally { db.close(); }
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(path.join(dataDir,'cache.json'),'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const cached = new Map();
  for (const source of Object.values(cache)) for (const entry of source?.entries || []) if (entry?.id && !cached.has(entry.id)) cached.set(entry.id,entry);
  for (const [id,entry] of cached) add(id,'cache',entry);
  const notes = noteDirs.map(dir => {
    const index = new Map();
    if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir).sort()) if (name.endsWith('.json')) index.set(name.slice(0,-5),fileHash(path.join(dir,name)));
    return index;
  });
  const stableEnv = Object.entries(env).filter(([key]) => key.startsWith('QMREADER_') && !['QMREADER_DB_FILE','QMREADER_DATA_DIR','QMREADER_PODCAST_NOTES_DIR','QMREADER_PODSCRIBE_NOTES_DIR','QMREADER_YOUTUBE_NOTES_DIR'].includes(key)).sort();
  global.push(['code', treeHash(path.join(app,'lib')), fileHash(path.join(app,'server.js')), fileHash(__filename), fileHash(path.join(__dirname,'export.cjs'))]);
  global.push(['environment',stableEnv],['signing-key',fileHash(path.join(dataDir,'wechat-images/.signing-key'))]);
  const digests = new Map([...perEntry].map(([id,digest]) => [id,digest.digest('hex')]));
  const signature = hash(encode(global));
  return { signature, entry(entry) {
    const raw = cached.get(entry.id) || entry;
    const names = new Set([entry.id]);
    try {
      const url = new URL(raw.link);
      const tail = url.pathname.split('/').filter(Boolean).at(-1);
      if (tail) names.add(tail);
      if (url.searchParams.get('v')) names.add(url.searchParams.get('v'));
    } catch {}
    return hash(encode([signature, digests.get(entry.id), entry, notes.map(index => [...names].sort().map(id => [id,index.get(id) || null]))]));
  }};
}
function previousProjection(dir, signature, now = Date.now()) {
  if (!dir) return null;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));
    const file = path.join(dir,'public.sqlite');
    if (state.version !== 1 || state.signature !== signature || !state.entries || !Number.isFinite(state.lastFullAt) || now-state.lastFullAt >= 86400000 || fileHash(file) !== state.sha256) return null;
    const db = new DatabaseSync(file,{readOnly:true});
    try { if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') return null; }
    finally { db.close(); }
    return { state, file };
  } catch { return null; } // Interrupted/missing/corrupt cache always rebuilds.
}
module.exports = { fingerprints, previousProjection, fileHash };
