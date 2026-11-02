const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('incremental export equals fresh full projection across content, assets, removals and recovery', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'rss-incremental-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const app=path.join(root,'app'),lib=path.join(app,'lib'),data=path.join(root,'data'),notes=path.join(root,'notes');
  for (const dir of [lib,data,notes]) fs.mkdirSync(dir,{recursive:true});
  const source=path.join(data,'source.sqlite');
  const db=new DatabaseSync(source);t.after(()=>db.close());
  db.exec(`CREATE TABLE entries(id TEXT PRIMARY KEY,source_id TEXT,title TEXT,content TEXT,link TEXT,deleted_at INTEGER DEFAULT 0);
    CREATE TABLE entry_rewrites(entry_id TEXT PRIMARY KEY,body TEXT);
    CREATE TABLE entry_translations(entry_id TEXT PRIMARY KEY,body TEXT);
    CREATE TABLE entry_stats(entry_id TEXT PRIMARY KEY,views INTEGER);
    CREATE TABLE commentaries(id TEXT PRIMARY KEY,entry_id TEXT,body TEXT);
    CREATE TABLE comment_reactions(comment_id TEXT,user_id TEXT,PRIMARY KEY(comment_id,user_id));
    CREATE TABLE users(id TEXT PRIMARY KEY,display_name TEXT);
    CREATE TABLE refresh_jobs(id TEXT PRIMARY KEY,status TEXT);`);
  const insert=db.prepare('INSERT INTO entries(id,source_id,title,content,link) VALUES(?,?,?,?,?)');
  insert.run('a','news','A','original A','https://example.test/a');
  insert.run('b','news','B','original B','https://example.test/b');
  insert.run('p','pod','Podcast','audio','https://example.test/episode');
  db.exec("INSERT INTO entry_rewrites VALUES('a','中文 A'); INSERT INTO entry_rewrites VALUES('p','播客中文'); INSERT INTO commentaries VALUES('comment-a','a','Public comment');");
  fs.writeFileSync(path.join(notes,'episode.json'),JSON.stringify({ready:true,hash:'ready'}));
  const write=(name,code)=>fs.writeFileSync(path.join(lib,name+'.js'),code);
  write('fixture',`const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(process.env.QMREADER_DB_FILE);
    function json(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
    function raw(row){return {id:row.id,sourceId:row.source_id,title:row.title,content:row.content,link:row.link,publishedTs:1};}
    function note(){return json(path.join(process.env.QMREADER_PODCAST_NOTES_DIR,'episode.json'),{});}
    module.exports={db,json,raw,note};`);
  write('fetcher',`const {db,json,raw}=require('./fixture'),path=require('node:path');
    module.exports={loadDisk(){},getSourceById(){return {};},
    getSourcesMeta(){const state=json(path.join(process.env.QMREADER_DATA_DIR,'state.json'),{});return ['news','pod'].map(id=>({id,enabled:state[id]!==false}));},
    getSourceEntryHistory({sourceId,deferAssets}){if(!deferAssets)throw Error('unexpected hydration');return {entries:db.prepare('SELECT * FROM entries WHERE source_id=? AND deleted_at=0 ORDER BY id').all(sourceId).map(raw),hasMore:false};},
    getEntriesByIds(ids){const cache=json(path.join(process.env.QMREADER_DATA_DIR,'cache.json'),{});return ids.map(id=>{
      const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id);const cached=Object.values(cache).flatMap(s=>s.entries||[]).find(e=>e.id===id);
      return {...(cached||raw(row)),stats:db.prepare('SELECT * FROM entry_stats WHERE entry_id=?').get(id)||null,
      reactions:db.prepare('SELECT COUNT(*) AS n FROM comment_reactions r JOIN commentaries c ON r.comment_id=c.id WHERE c.entry_id=?').get(id).n,
      rewriteReady:!!db.prepare('SELECT * FROM entry_rewrites WHERE entry_id=?').get(id)};});}};`);
  write('store',`const {db}=require('./fixture');module.exports={getRewrite(id){const r=db.prepare('SELECT * FROM entry_rewrites WHERE entry_id=?').get(id);return r?{body:r.body,contentHash:'ready'}:null;},getTranslation(id){const r=db.prepare('SELECT * FROM entry_translations WHERE entry_id=?').get(id);return r?{body:r.body,contentHash:'ready'}:null;},getEntryAssetReaction(){return {helpfulCount:0};}};`);
  write('deepseek',`const {note}=require('./fixture');module.exports={rewriteContentHash(e){return e.sourceId==='pod'?(note().hash||'missing'):'ready';},translationInputHash(){return 'ready';}};`);
  write('podcast-transcript',`const {note}=require('./fixture');module.exports={isTranscriptPodcast(e){return e.sourceId==='pod';},loadReadyTranscript(){return note().ready?note():null;},stripAudioTimestamps(v){return v;}};`);
  write('podscribe-entry','module.exports={isPodscribeEntry(){return false;}};');
  write('wechat-images','module.exports={createWechatImageService(){return {rewriteEntry(e){return e;}};}};');
  let serial=0,previous;
  function run(force=false) {
    const dir=path.join(root,'run-'+(++serial));fs.mkdirSync(dir);
    const result=spawnSync(process.execPath,[path.join(__dirname,'export.cjs'),path.join(dir,'public.sqlite')],{encoding:'utf8',env:{...process.env,
      RSS_DR_APP:app,RSS_DR_STAGE:root,QMREADER_DB_FILE:source,QMREADER_DATA_DIR:data,QMREADER_PODCAST_NOTES_DIR:notes,
      RSS_DR_STATE_FILE:path.join(dir,'state.json'),RSS_DR_PREVIOUS:previous||'',RSS_DR_FORCE_FULL:force?'1':'0'}});
    assert.equal(result.status,0,result.stderr);
    const stats=JSON.parse(result.stdout.trim().split('\n').at(-1));return {dir,stats};
  }
  function rows(dir) { const d=new DatabaseSync(path.join(dir,'public.sqlite'),{readOnly:true});try{return ['entries','sources','images'].map(table=>d.prepare('SELECT * FROM '+table+' ORDER BY 1').all());}finally{d.close();} }
  function verify(expectedGenerated,expectedDeleted=0) {
    const next=run(),full=run(true);assert.deepEqual(rows(next.dir),rows(full.dir));
    assert.equal(next.stats.generated,expectedGenerated,JSON.stringify(next.stats));assert.equal(next.stats.deleted,expectedDeleted);
    previous=next.dir;return next;
  }
  assert.equal(verify(3).stats.mode,'full');
  assert.equal(verify(0).stats.reused,3);
  db.exec("UPDATE entry_rewrites SET body='更新中文 A' WHERE entry_id='a'");verify(1);
  db.exec("INSERT INTO entry_translations VALUES('b','中文翻译 B')");verify(1);
  db.exec("DELETE FROM entry_translations WHERE entry_id='b'");verify(1);
  db.exec("UPDATE entries SET content='Edited original',title='Edited title' WHERE id='b'");verify(1);
  db.exec("UPDATE entries SET source_id='pod' WHERE id='b'");verify(1);
  db.exec("UPDATE entries SET source_id='news' WHERE id='b'");verify(1);
  db.exec("DELETE FROM entry_rewrites WHERE entry_id='a'");verify(1);
  db.exec("INSERT INTO comment_reactions VALUES('comment-a','u')");verify(1);
  db.exec("DELETE FROM comment_reactions");verify(1);
  db.exec("INSERT INTO entry_stats VALUES('b',7)");verify(1);
  db.exec("INSERT INTO refresh_jobs VALUES('poll','running')");verify(0);
  fs.writeFileSync(path.join(data,'cache.json'),JSON.stringify({news:{fetchedAt:123,entries:[{id:'a',sourceId:'news',title:'A',content:'enriched cache body',link:'https://example.test/a',publishedTs:1}]}}));verify(1);
  fs.writeFileSync(path.join(notes,'episode.json'),JSON.stringify({ready:true,hash:'new transcript'}));verify(1);
  fs.unlinkSync(path.join(notes,'episode.json'));verify(1);
  insert.run('c','news','C','new C','https://example.test/c');verify(1);
  db.exec("UPDATE entries SET deleted_at=1 WHERE id='a'");verify(0,1);
  db.exec("DELETE FROM entries WHERE id='c'");verify(0,1);
  fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({pod:false}));verify(0,1);
  fs.writeFileSync(path.join(data,'state.json'),'{}');verify(1);
  // Image arrival and eviction are independent of article changes.
  const imageUrl='https://mmbiz.qpic.cn/mmbiz_png/test/0',token=Buffer.from(imageUrl).toString('base64url')+'.'+'a'.repeat(22);
  db.prepare('UPDATE entries SET content=? WHERE id=?').run('https://rss.qiaomu.ai/media/wechat/'+token,'b');verify(1);
  fs.mkdirSync(path.join(data,'wechat-images'));const digest=require('node:crypto').createHash('sha256').update(imageUrl).digest('hex');
  const imageFile=path.join(data,'wechat-images',digest+'.bin');fs.writeFileSync(imageFile,Buffer.from('89504e470d0a1a0a','hex'));assert.equal(rows(verify(0).dir)[2].length,1);
  fs.unlinkSync(imageFile);assert.equal(rows(verify(0).dir)[2].length,0);
  // Corrupt/unpaired cache falls back, without exposing its private state.
  fs.appendFileSync(path.join(previous,'public.sqlite'),'corruption');assert.equal(verify(2).stats.mode,'full');
  const stateFile=path.join(previous,'state.json'),state=JSON.parse(fs.readFileSync(stateFile));state.lastFullAt=Date.now()-86400001;fs.writeFileSync(stateFile,JSON.stringify(state));assert.equal(verify(2).stats.mode,'full');
  fs.appendFileSync(path.join(lib,'fetcher.js'),'\n// code update');assert.equal(verify(2).stats.mode,'full');
  assert.deepEqual(fs.readdirSync(path.join(previous,'wechat-images')),[]);
});
