// Run only against a consistent temporary clone, never the production database.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const app = process.env.RSS_DR_APP || '/opt/qiaomu-apps/qmreader';
const output = process.argv[2];
if (!output || !process.env.QMREADER_DB_FILE || !process.env.QMREADER_DB_FILE.startsWith(process.env.RSS_DR_STAGE + '/')) throw Error('A staging database is required');
const fetcher = require(path.join(app, 'lib/fetcher'));
const store = require(path.join(app, 'lib/store'));
const deepseek = require(path.join(app, 'lib/deepseek'));
const podcast = require(path.join(app, 'lib/podcast-transcript'));
const podscribe = require(path.join(app, 'lib/podscribe-entry'));
const images = require(path.join(app, 'lib/wechat-images')).createWechatImageService();
fetcher.loadDisk({ upsert: false });
const { fingerprints, previousProjection, fileHash } = require('./incremental.cjs');
const inputs = process.env.RSS_DR_STATE_FILE ? fingerprints({
  dbFile: process.env.QMREADER_DB_FILE, dataDir: process.env.QMREADER_DATA_DIR, app,
  noteDirs: ['QMREADER_PODCAST_NOTES_DIR','QMREADER_PODSCRIBE_NOTES_DIR','QMREADER_YOUTUBE_NOTES_DIR'].map(key => process.env[key]).filter(Boolean),
}) : null;
const previous = inputs && process.env.RSS_DR_FORCE_FULL !== '1' ? previousProjection(process.env.RSS_DR_PREVIOUS, inputs.signature) : null;
const nextState = inputs ? { version: 1, signature: inputs.signature, lastFullAt: previous?.state.lastFullAt || Date.now(), entries: {} } : null;
const db = new DatabaseSync(output);
db.exec('CREATE TABLE sources(id TEXT PRIMARY KEY,data TEXT NOT NULL,separate INTEGER); CREATE TABLE images(token TEXT PRIMARY KEY,digest TEXT,mime TEXT); CREATE TABLE entries(id TEXT PRIMARY KEY,source TEXT,published INTEGER,data TEXT NOT NULL,rewrite TEXT NOT NULL,translation TEXT NOT NULL,rewrite_ready INTEGER); CREATE INDEX entry_page ON entries(source,published DESC,id DESC);');
if (previous) db.prepare('ATTACH DATABASE ? AS previous').run(previous.file);
const reuse = previous ? db.prepare('INSERT INTO entries SELECT * FROM previous.entries WHERE id=?') : null;
const imageDir = path.join(path.dirname(output), 'wechat-images'); fs.mkdirSync(imageDir);
const putImage = db.prepare('INSERT OR IGNORE INTO images VALUES(?,?,?)');
const crypto = require('node:crypto');
function copyPublicImages(entry) {
  for (const match of JSON.stringify(entry).matchAll(/https:\/\/rss\.qiaomu\.ai\/media\/wechat\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22})/g)) {
    const token = match[1], url = Buffer.from(token.split('.')[0], 'base64url').toString();
    const digest = crypto.createHash('sha256').update(url).digest('hex');
    const source = path.join(process.env.QMREADER_DATA_DIR, 'wechat-images', digest + '.bin');
    if (!fs.existsSync(source)) continue;
    const bytes = fs.readFileSync(source);
    const mime = bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes.subarray(0,3).toString() === 'GIF' ? 'image/gif' : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : '';
    if (!mime || bytes.length > 8*1024*1024) continue;
    const target = path.join(imageDir,digest+'.bin'); if (!fs.existsSync(target)) fs.copyFileSync(source,target);
    putImage.run(token,digest,mime);
  }
}
const putSource = db.prepare('INSERT INTO sources VALUES(?,?,?)');
const put = db.prepare('INSERT OR REPLACE INTO entries VALUES(?,?,?,?,?,?,?)');
let count = 0, generated = 0, reused = 0;
const seen = new Set();
const canBatch = typeof fetcher.getEntriesByIds === 'function';
db.exec('BEGIN');
for (const source of fetcher.getSourcesMeta()) {
  putSource.run(source.id, JSON.stringify(source), fetcher.getSourceById(source.id)?.separate ? 1 : 0);
  if (source.enabled === false) continue;
  let cursor = ''; const cursors = new Set();
  while (true) {
    const page = fetcher.getSourceEntryHistory({ sourceId: source.id, cursor, limit: 100, deferAssets: canBatch });
    if (!page) break;
    const changed = page.entries.filter(entry => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      if (!inputs) return true;
      const fingerprint = inputs.entry(entry);
      nextState.entries[entry.id] = fingerprint;
      if (previous?.state.entries[entry.id] === fingerprint && reuse.run(entry.id).changes === 1) {
        count++; reused++; return false;
      }
      return true;
    });
    const entries = canBatch
      ? fetcher.getEntriesByIds(changed.map(entry => entry.id))
      : changed.map(listed => fetcher.getEntryById(listed.id) || listed);
    if (entries.length !== changed.length) throw Error('incomplete_hydration');
    for (const hydrated of entries) {
      const entry = images.rewriteEntry(hydrated);
      let rewrite = store.getRewrite(entry.id), translation = store.getTranslation(entry.id);
      if (rewrite && (podcast.isTranscriptPodcast(entry) && (!podcast.loadReadyTranscript(entry) || rewrite.contentHash !== deepseek.rewriteContentHash(entry)) || podscribe.isPodscribeEntry(entry) && (!podscribe.loadReady(entry) || rewrite.contentHash !== deepseek.rewriteContentHash(entry)))) rewrite = null;
      if (rewrite) rewrite = { ...rewrite, ...store.getEntryAssetReaction(entry.id, 'rewrite', null), body: podcast.isTranscriptPodcast(entry) ? podcast.stripAudioTimestamps(rewrite.body) : rewrite.body, stale: entry.sourceId === 'producthunt' ? !/^ph-official-v2:[a-f0-9]+$/i.test(rewrite.contentHash || '') : Boolean(rewrite.contentHash && rewrite.contentHash !== deepseek.rewriteContentHash(entry)) };
      if (translation) translation = { ...translation, ...store.getEntryAssetReaction(entry.id, 'translation', null), stale: Boolean(translation.contentHash && translation.contentHash !== deepseek.translationInputHash(entry)) };
      put.run(entry.id, entry.sourceId, entry.publishedTs || 0, JSON.stringify(entry), JSON.stringify(rewrite), JSON.stringify(translation), entry.rewriteReady ? 1 : 0); count++; generated++;
    }
    if (!page.hasMore) break;
    if (!page.nextCursor || cursors.has(page.nextCursor)) throw Error('invalid_source_pagination');
    cursor = page.nextCursor; cursors.add(cursor);
  }
}
// Reconcile media from the current visible rows, including cache eviction/deletion.
for (const row of db.prepare('SELECT data FROM entries').iterate()) copyPublicImages(JSON.parse(row.data));
db.exec('COMMIT');
if (!count || db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('invalid_projection');
db.close();
const deleted = previous ? Object.keys(previous.state.entries).filter(id => !seen.has(id)).length : 0;
if (nextState) {
  nextState.sha256 = fileHash(output);
  fs.writeFileSync(process.env.RSS_DR_STATE_FILE, JSON.stringify(nextState), { mode: 0o600 });
}
console.log(JSON.stringify({ entries: count, generated, reused, deleted, mode: previous ? 'incremental' : 'full' }));
// Production modules may own scheduler handles. This one-shot export must terminate here.
process.exit(0);
