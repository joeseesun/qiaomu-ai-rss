const test=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os'),{join}=require('node:path');
const {createResponseCache,sendCached,compactEntry}=require('./response-cache.cjs');
test('external writes immediately invalidate prepared responses',()=>{let version=1,calls=0;const c=createResponseCache({stamp:()=>version});const get=()=>c.get('list',()=>({value:++calls}));assert.equal(get().payload.value,1);version++;assert.equal(get().payload.value,2);});
test('an async result cannot repopulate cache after a clear or external write',async()=>{let version=1,release;const c=createResponseCache({stamp:()=>version});const pending=c.getAsync('a',()=>new Promise(r=>release=r));c.clear();version++;release({old:true});await pending;assert.equal(c.size(),0);});
test('cached bodies respect a byte budget as well as count',()=>{const c=createResponseCache({maxBytes:200,stamp:()=>0});c.get('large',()=>({body:'x'.repeat(1000)}));assert.equal(c.size(),0);});
test('compact list removes heavy fields without altering original payload',()=>{const a={id:'a',title:'A',content:'body',summary:'Keep',assets:{rewriteBody:'x'.repeat(1000)},stats:{views:1},signals:[],rewriteStatus:'ready',rewriteReady:true};const b=compactEntry(a);assert.equal(b.summary,'Keep');for(const key of ['content','assets','stats','signals','rewriteStatus','rewriteReady'])assert.equal(b[key],undefined);assert.ok(a.assets);});
test('prepared response preserves format negotiation and cannot leak via shared CDN cache',()=>{const c=createResponseCache({stamp:()=>0}),headers={};const res={setHeader:(k,v)=>headers[k]=v,end(){},status(){return this;}};sendCached({headers:{'accept-encoding':'gzip;q=0'}},res,c.get('x',()=>({body:'x'.repeat(1500)})),{shared:true});assert.match(headers.Vary,/X-Rss-List/);assert.equal(headers['Cache-Control'],'no-store');assert.equal(headers['Content-Encoding'],undefined);});
test('default cache stamp observes external SQLite WAL writes on disk',()=>{
 const directory=mkdtempSync(join(tmpdir(),'qrs-cache-stamp-'));const previous=process.env.QMREADER_DATA_DIR,previousDb=process.env.QMREADER_DB_FILE;
 process.env.QMREADER_DATA_DIR=directory;delete process.env.QMREADER_DB_FILE;
 try{
  writeFileSync(join(directory,'qmreader.sqlite'),'database');const cache=createResponseCache();let calls=0;
  const read=()=>cache.get('entries',()=>({generation:++calls})).payload.generation;
  assert.equal(read(),1);assert.equal(read(),1);
  writeFileSync(join(directory,'qmreader.sqlite-wal'),'external deletion');assert.equal(read(),2);
  writeFileSync(join(directory,'qmreader.sqlite-wal'),'external deletion plus another change');assert.equal(read(),3);
 }finally{if(previous===undefined)delete process.env.QMREADER_DATA_DIR;else process.env.QMREADER_DATA_DIR=previous;if(previousDb===undefined)delete process.env.QMREADER_DB_FILE;else process.env.QMREADER_DB_FILE=previousDb;rmSync(directory,{recursive:true,force:true});}
});
