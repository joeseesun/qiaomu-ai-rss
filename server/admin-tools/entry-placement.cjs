'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createPlacement({ dbFile, getSource }) {
  const db = new DatabaseSync(dbFile);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS entry_channel_moves (
      entry_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, original_source_id TEXT NOT NULL,
      moved_by TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS preserve_entry_channel_move AFTER UPDATE OF source_id ON entries
    WHEN EXISTS (SELECT 1 FROM entry_channel_moves m WHERE m.entry_id=NEW.id AND m.source_id<>NEW.source_id)
    BEGIN UPDATE entries SET source_id=(SELECT source_id FROM entry_channel_moves WHERE entry_id=NEW.id) WHERE id=NEW.id; END;
  `);
  const moves = new Map(db.prepare('SELECT * FROM entry_channel_moves').all().map(row => [row.entry_id, row]));
  return {
    decorate(entry) {
      const move = entry && moves.get(entry.id);
      if (!move) return entry;
      const source = getSource(move.source_id);
      return { ...entry, sourceId: move.source_id, sourceName: source?.name || move.source_id, feedSourceIds: [move.source_id] };
    },
    entries() { return [...moves.keys()]; },
    move(entryId, sourceId, userId) {
      const source = getSource(sourceId);
      if (!source) throw Object.assign(new Error('invalid_source'), { statusCode: 400 });
      db.exec('BEGIN IMMEDIATE');
      let row;
      try {
        const entry = db.prepare('SELECT source_id FROM entries WHERE id=? AND COALESCE(deleted_at,0)=0').get(entryId);
        if (!entry) { db.exec('ROLLBACK'); return null; }
        row = { entry_id: entryId, source_id: sourceId, original_source_id: moves.get(entryId)?.original_source_id || entry.source_id, moved_by: userId, updated_at: Date.now() };
        if (sourceId === row.original_source_id) db.prepare('DELETE FROM entry_channel_moves WHERE entry_id=?').run(entryId);
        else db.prepare(`INSERT INTO entry_channel_moves VALUES (?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET source_id=excluded.source_id,moved_by=excluded.moved_by,updated_at=excluded.updated_at`).run(entryId,sourceId,row.original_source_id,userId,row.updated_at);
        db.prepare('UPDATE entries SET source_id=?,updated_at=? WHERE id=?').run(sourceId,row.updated_at,entryId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      if (sourceId === row.original_source_id) moves.delete(entryId); else moves.set(entryId, row);
      return { entryId, sourceId, sourceName: source.name };
    },
    close() { db.close(); },
  };
}
let singleton;
function placement(getSource) {
  if (!singleton) singleton = createPlacement({
    dbFile: process.env.QMREADER_DB_FILE || path.join(process.env.QMREADER_DATA_DIR || path.join(__dirname,'..','data'), 'qmreader.sqlite'), getSource,
  });
  return singleton;
}
module.exports = { createPlacement, placement };
