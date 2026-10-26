const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cheerio = require('cheerio');
const { DatabaseSync } = require('node:sqlite');
const { splitTranslationBlocks, preservesAttribution } = require('./admin-tools/translation-blocks.cjs');
const { createPlacement } = require('./admin-tools/entry-placement.cjs');
const { mountLabModeration } = require('./lab-moderation');
const stripHtml = html => cheerio.load(html, {}, false).root().text();
const cost = b => JSON.stringify({ i:b.i,tag:b.tag,text:b.source,html:b.sourceHtml }).length;
function blocks(html,tag='figure') {return [{i:0,tag,kind:'text',sourceHtml:html,source:stripHtml(html)}];}
test('splits oversized figures, lists and nested paragraphs without losing text, images or links', () => {
  for (const html of [
    `<figure>${Array.from({length:80},(_,i)=>`<img src="https://example.org/${i}.webp" alt="${i}">Figure ${i}. `).join('')}<figcaption>${'Caption. '.repeat(1200)}</figcaption></figure>`,
    `<ol>${Array.from({length:60},(_,i)=>`<li><a href="https://example.org/${i}">${'Reference '+i+' text. '.repeat(30)}</a></li>`).join('')}</ol>`,
    `<p><a href="https://example.org/nested"><strong>${'Long Unicode 中文 paragraph. '.repeat(1500)}</strong></a></p>`,
  ]) {
    const input=blocks(html); assert.ok(cost(input[0])>10000);
    const out=splitTranslationBlocks(input,{cheerio,stripHtml});
    assert.ok(out.length>1); assert.ok(out.every(b=>cost(b)<=10000));
    assert.equal(out.map(b=>b.source).join(''),stripHtml(html));
    const before=cheerio.load(html), after=cheerio.load(out.map(b=>b.sourceHtml).join(''));
    assert.deepEqual(after('img').map((_,e)=>after(e).attr('src')).get(),before('img').map((_,e)=>before(e).attr('src')).get());
    assert.deepEqual([...new Set(after('a').map((_,e)=>after(e).attr('href')).get())],[...new Set(before('a').map((_,e)=>before(e).attr('href')).get())]);
    assert.deepEqual(out.map(b=>b.i),out.map((_,i)=>i));
  }
});
test('small blocks, code and media preserve original content',()=>{
  const input=[...blocks('<p>Hello</p>','p'),{i:1,tag:'pre',kind:'code',source:'code',sourceHtml:'<pre>'+ 'x'.repeat(12000)+'</pre>'}];
  assert.deepEqual(splitTranslationBlocks(input,{cheerio,stripHtml}),input);
});
test('channel move persists across ingestion/restart and retains entry content and identity',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rss-move-')),file=path.join(root,'db.sqlite');
  const db=new DatabaseSync(file);db.exec('CREATE TABLE entries(id TEXT PRIMARY KEY,source_id TEXT,content TEXT,updated_at INTEGER,deleted_at INTEGER); INSERT INTO entries VALUES (\'e\',\'old\',\'original article\',0,0)');
  const getSource=id=>['old','target'].includes(id)?{id,name:id}:null;
  let p=createPlacement({dbFile:file,getSource});
  try {
    assert.throws(()=>p.move('e','forged','admin'),/invalid_source/);
    assert.equal(p.move('missing','target','admin'),null);
    assert.equal(p.move('e','target','admin').sourceId,'target');
    db.prepare('UPDATE entries SET source_id=?,content=? WHERE id=?').run('old','refreshed article','e');
    assert.deepEqual({...db.prepare('SELECT id,source_id,content FROM entries').get()},{id:'e',source_id:'target',content:'refreshed article'});
    p.close();p=createPlacement({dbFile:file,getSource});
    assert.equal(p.decorate({id:'e',sourceId:'old'}).sourceId,'target');
    p.move('e','old','admin');assert.deepEqual(p.entries(),[]);assert.equal(db.prepare('SELECT source_id FROM entries').get().source_id,'old');
    db.exec('UPDATE entries SET deleted_at=1');assert.equal(p.move('e','target','admin'),null);
  } finally {p.close();db.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('move API rejects expired/ordinary users, validates targets, and returns persisted destination',()=>{
  const routes={},calls=[];
  mountLabModeration({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h},{store:{getUserBySessionToken:t=>t==='admin'?{id:'owner',role:'admin'}:t==='reader'?{role:'user'}:null},getSources:()=>[{id:'target',name:'Target'}],moveEntry:(entryId,sourceId,userId)=>{calls.push({entryId,sourceId,userId});return {entryId,sourceId,sourceName:'Target'}}});
  const call=(token,body)=>{const res={statusCode:200,status(c){this.statusCode=c;return this},setHeader(){},json(d){this.data=d;return this}};routes['/api/lab/admin/move-entry']({get:()=>`Bearer ${token}`,body},res);return res};
  for(const token of ['', 'invite','expired','reader']) assert.equal(call(token,{entryId:'e',sourceId:'target'}).statusCode,403);
  assert.equal(calls.length,0);assert.equal(call('admin',{entryId:'e',sourceId:''}).statusCode,400);
  assert.deepEqual(call('admin',{entryId:'e',sourceId:'target'}).data,{ok:true,entryId:'e',sourceId:'target',sourceName:'Target'});
  assert.equal(calls[0].userId,'owner');
});

test('keeps a linked name-only byline verbatim but rejects untranslated prose and headings', () => {
  const byline={i:2,tag:'p',source:'Nick Cammarata Goodfire',sourceHtml:'<p>Nick Cammarata <a href="https://goodfire.com/">Goodfire</a></p>'};
  assert.equal(preservesAttribution(byline,'Nick Cammarata Goodfire'),true);
  assert.equal(preservesAttribution(byline,'Nick Cammarata'),false);
  assert.equal(preservesAttribution({...byline,tag:'h2'},byline.source),false);
  assert.equal(preservesAttribution({...byline,i:100},byline.source),false);
  assert.equal(preservesAttribution({...byline,source:'Neural Networks Are Already Clean'},'Neural Networks Are Already Clean'),false);
});

test('translation checkpoints retain successful blocks across failure and restart, isolate changed input/model', async () => {
  const { createProgress } = require('./admin-tools/translation-progress.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-progress-')), file = path.join(dir,'progress.sqlite');
  let progress = createProgress(file);
  const config = { model: 'deepseek-flash', provider: 'test' }, entry = { id: 'one', title: 'Test' };
  const chunks = [{ i: 0, source: 'First' }, { i: 1, source: 'Second' }];
  try {
    await assert.rejects(progress.run(config, entry, chunks, async (_c,_e,_b,save) => { save({ pairs: [{ ...chunks[0], target:'第一' }], titleZh:'测试' }); throw Error('network'); }));
    progress.close(); progress = createProgress(file);
    const resumed = await progress.run(config, entry, chunks, async (_c,_e,pending) => { assert.deepEqual(pending.map(b=>b.i),[1]); return { pairs:[{...pending[0],target:'第二'}] }; });
    assert.equal(resumed.pairs.length,2); assert.equal(resumed.titleZh,'测试');
    await progress.run(config, entry, chunks, () => { throw Error('must reuse'); });
    let changed = 0;
    await progress.run({...config,model:'other'}, entry, chunks, async (_c,_e,pending) => { changed=pending.length; return {pairs:pending}; });
    assert.equal(changed,2);
    await progress.run(config, {...entry,title:'changed'}, chunks, async (_c,_e,pending) => { assert.equal(pending.length,2); return {pairs:pending}; });
  } finally { progress.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
