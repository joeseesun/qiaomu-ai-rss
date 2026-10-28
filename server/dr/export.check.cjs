const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

for (const batching of [true, false]) {
  test(`projection preserves data and visibility with ${batching ? 'batch' : 'legacy'} Reader`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-projection-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const app = path.join(root, 'app');
    const lib = path.join(app, 'lib');
    fs.mkdirSync(lib, { recursive: true });
    const entry = { id: 'public-entry', sourceId: 'public-source', title: 'Article', content: 'Full original', publishedTs: 123, rewriteReady: true, stats: { viewCount: 4 } };
    const write = (name, source) => fs.writeFileSync(path.join(lib, name + '.js'), source);
    write('fetcher', `const entry=${JSON.stringify(entry)};
      module.exports={loadDisk(){},getSourcesMeta(){return [{id:'public-source'},{id:'disabled',enabled:false}];},
      getSourceById(){return {};},getSourceEntryHistory(args){
        if(args.sourceId==='disabled')throw Error('disabled source was read');
        ${batching ? "if(!args.deferAssets)throw Error('page hydrated unnecessarily');" : ''}
        return {entries:[entry],hasMore:false};},
      getEntryById(){${batching ? "throw Error('per-entry hydration must not run');" : 'return entry;'}}
      ${batching ? ',getEntriesByIds(ids){if(ids.length!==1||ids[0]!==entry.id)throw Error("wrong batch");return [entry];}' : ''}};`);
    write('store', `module.exports={getRewrite(){return {body:'完整中文',contentHash:'hash'};},getTranslation(){return {body:'Translation',contentHash:'hash'};},getEntryAssetReaction(){return {helpfulCount:2};}};`);
    write('deepseek', "module.exports={rewriteContentHash(){return 'hash';},translationInputHash(){return 'hash';}};");
    write('podcast-transcript', 'module.exports={isTranscriptPodcast(){return false;}};');
    write('podscribe-entry', 'module.exports={isPodscribeEntry(){return false;}};');
    write('wechat-images', 'module.exports={createWechatImageService(){return {rewriteEntry(e){return e;}};}};');
    const output = path.join(root, 'public.sqlite');
    const result = spawnSync(process.execPath, [process.env.DR_EXPORT_SCRIPT || path.join(__dirname, 'export.cjs'), output], {
      env: { ...process.env, RSS_DR_APP: app, RSS_DR_STAGE: root, QMREADER_DB_FILE: path.join(root, 'source.sqlite'), QMREADER_DATA_DIR: root }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const db = new DatabaseSync(output, { readOnly: true });
    t.after(() => db.close());
    const rows = db.prepare('SELECT * FROM entries').all();
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].data), entry);
    assert.equal(JSON.parse(rows[0].rewrite).body, '完整中文');
    assert.equal(JSON.parse(rows[0].translation).body, 'Translation');
    assert.equal(rows[0].rewrite_ready, 1);
    assert.equal(JSON.parse(rows[0].rewrite).helpfulCount, 2);
  });
}
