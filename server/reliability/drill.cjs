'use strict';
// Real restricted-SSH failover, with all canonical writes confined to a temporary database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-failover-drill-'));
process.env.QMREADER_DATA_DIR = directory;
process.env.QMREADER_DB_FILE = path.join(directory, 'drill.sqlite');
process.env.RSS_SOURCE_TIMEOUT_MS = '1';
const fetcher = require(path.join(process.env.RSS_APP_DIR || '/opt/qiaomu-apps/qmreader', 'lib/fetcher.js'));
require('./bounded-fetch.cjs').install(fetcher);
const store = require(path.join(process.env.RSS_APP_DIR || '/opt/qiaomu-apps/qmreader', 'lib/store.js'));
(async () => {
  const source = fetcher.getSourceById('qiaomu-blog');
  const result = await fetcher.fetchSource(source);
  assert.equal(result.status, 'ok');
  assert.equal(result.fetchOrigin, 'standby');
  assert.ok(result.entries.length > 0);
  assert.ok(store.getEntry(result.entries[0].id));
  const deletedId = result.entries[0].id;
  store.softDeleteEntry(deletedId, { reason: 'isolated failover drill' });
  fetcher.acceptRemoteResult(source, result);
  assert.ok(store.isEntryDeleted(deletedId));
  assert.ok(!fetcher.getEntries({ sourceId: source.id, limit: 30 }).some(entry => entry.id === deletedId));
  console.log(JSON.stringify({ failover: true, origin: result.fetchOrigin, entries: result.entries.length, deletionPreserved: true, isolatedDatabase: true }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
