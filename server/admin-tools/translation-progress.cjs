'use strict';
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const path = require('node:path');
function createProgress(dbFile) {
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS translation_progress (key TEXT PRIMARY KEY, result TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  // Bound abandoned progress without expiring active work.
  db.prepare('DELETE FROM translation_progress WHERE updated_at < ?').run(Date.now() - 30 * 86400000);
  return {
    async run(config, entry, chunk, translate) {
      const key = createHash('sha256').update(JSON.stringify(['v1', entry.id, entry.title, entry.summary, config.provider, config.baseUrl, config.model, chunk])).digest('hex');
      let saved;
      try { saved = JSON.parse(db.prepare('SELECT result FROM translation_progress WHERE key=?').get(key)?.result || '{}'); } catch { saved = {}; }
      const pairs = new Map((saved.pairs || []).map(pair => [Number(pair.i), pair]));
      const pending = chunk.filter(block => !pairs.has(Number(block.i)));
      if (!pending.length) return saved;
      const record = partial => {
        for (const pair of partial.pairs) pairs.set(Number(pair.i), pair);
        saved = { pairs: [...pairs.values()], titleZh: saved.titleZh || partial.titleZh || '', summaryZh: saved.summaryZh || partial.summaryZh || '' };
        db.prepare('INSERT INTO translation_progress VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET result=excluded.result,updated_at=excluded.updated_at').run(key, JSON.stringify(saved), Date.now());
      };
      const result = await translate(config, entry, pending, record);
      record(result);
      return { ...saved, pairs: chunk.map(block => pairs.get(Number(block.i))) };
    },
    close() { db.close(); },
  };
}
let singleton;
function progress() {
  return singleton ||= createProgress(process.env.QMREADER_DB_FILE || path.join(process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data'), 'qmreader.sqlite'));
}
// Continue independent chunks after a failure so retries reuse all successful work.
async function translateChunks(chunks, run, concurrency = 2) {
  const results = new Array(chunks.length); let next = 0;
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
    while (next < chunks.length) {
      const index = next++;
      try { results[index] = await run(chunks[index]); }
      catch (error) { errors.push(error); }
    }
  }));
  if (errors.length) throw errors[0];
  return results;
}
module.exports = { createProgress, progress, translateChunks };
