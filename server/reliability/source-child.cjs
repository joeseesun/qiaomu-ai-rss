'use strict';
const path = require('node:path');
process.on('disconnect', () => process.exit(1));
process.once('message', async input => {
  try {
    const fetcher = require(path.join(process.env.RSS_APP_DIR || '/opt/qiaomu-apps/qmreader', 'lib/fetcher.js'));
    fetcher.loadDisk({ upsert: false });
    if (!input.source || !/^[a-zA-Z0-9_-]{1,180}$/.test(input.source.id) || input.source.manual) throw Error('invalid_source');
    const result = await fetcher.fetchSource(input.source);
    fetcher.flushDisk();
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, error: 'source_fetch_failed' }, () => process.exit(1));
  }
});
