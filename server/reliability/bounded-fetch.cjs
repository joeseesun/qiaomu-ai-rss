'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isolated, stopChildren } = require('./process.cjs');
const events = [];
function record(sourceId, kind) {
  const event = { at: Date.now(), sourceId, kind }; events.push(event); if (events.length > 100) events.shift();
  console.log('[rss-fetch]', JSON.stringify(event));
  try {
    const directory = process.env.QMREADER_DATA_DIR || path.join(process.env.RSS_APP_DIR || '/opt/qiaomu-apps/qmreader', 'data');
    fs.mkdirSync(path.join(directory, 'fetch-events'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'fetch-events', sourceId + '.json'), JSON.stringify(event));
  } catch { /* The independent health check also catches missing observations. */ }
}
function remoteSource(source) {
  // Only public feed configuration is transmitted, never accounts or AI profiles.
  const fields = ['id', 'name', 'category', 'siteUrl', 'feeds', 'combineFeeds', 'podscribeSlug', 'limit', 'contentKind', 'bestblogsWechatId', 'enabled', 'optIn', 'description'];
  return Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
function install(fetcher, options = {}) {
  if (fetcher.__boundedInstalled) return;
  fetcher.__boundedInstalled = true;
  const run = options.run || isolated;
  fetcher.fetchSource = async source => {
    let local, error;
    try {
      local = await run(path.join(__dirname, 'source-child.cjs'), { source }, { timeout: Number(process.env.RSS_SOURCE_TIMEOUT_MS || 60000) });
      if (local.status === 'ok') { fetcher.loadDisk({ upsert: false }); record(source.id, 'primary_ok'); return local; }
    } catch (e) { error = e; record(source.id, e.code === 'SOURCE_TIMEOUT' ? 'primary_timeout' : 'primary_failed'); }
    if (process.env.RSS_FETCH_SSH_TARGET) {
      try {
        const remote = await run(null, { action: 'fetch', source: remoteSource(source) }, {
          ssh: true, executable: '/usr/bin/ssh', timeout: 95000,
          args: ['-T', '-i', process.env.RSS_FETCH_SSH_KEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + (process.env.RSS_FETCH_KNOWN_HOSTS || '/etc/rss-dr/known_hosts'), '-o', 'ConnectTimeout=5', process.env.RSS_FETCH_SSH_TARGET],
        });
        const result = fetcher.acceptRemoteResult(source, remote);
        record(source.id, 'standby_ok'); return result;
      } catch { record(source.id, 'standby_failed'); }
    }
    fetcher.loadDisk({ upsert: false });
    return local || fetcher.recordSourceFailure(source, error || Error('source_fetch_failed'));
  };
  process.once('SIGTERM', () => { stopChildren(); process.exit(1); });
}
module.exports = { install, remoteSource };
