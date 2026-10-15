const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createResponseCache,sendCached,compactEntry}=require('./response-cache.cjs');
const {middleware}=require('./public-read-cache.cjs');
const express=require(require.resolve('express',{paths:[process.env.QMREADER_MODULES||process.cwd()]}));
test('prepared cache and older middleware preserve compact gzip, ETags, external deletion and session separation',async()=>{
 const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'qrs-prepared-'));const app=express();let generation=0,calls=0,deleted=false;
 const prepared=createResponseCache({stamp:()=>generation});app.use(middleware({directory}));
 app.get('/api/entries',(req,res)=>{const compact=req.get('X-Rss-List')==='reader-v1';const shared=prepared.get(String(compact),()=>{calls++;const entry={id:'a',title:'A',summary:'Text',assets:{body:'x'.repeat(5000)},stats:{views:1},content:'original'};return{entries:deleted?[]:[compact?compactEntry(entry):entry]};});if(req.get('Cookie'))return res.json({entries:[{id:'private'}]});sendCached(req,res,shared,{shared:true});});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/entries';
 try{
 const legacy=await fetch(url);const legacyTag=legacy.headers.get('etag');assert.ok((await legacy.json()).entries[0].assets);
 const result=await fetch(url,{headers:{'X-Rss-List':'reader-v1'}});const tag=result.headers.get('etag');assert.notEqual(tag,legacyTag);assert.match(result.headers.get('vary'),/X-Rss-List/);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json()).entries[0].assets,undefined);
 assert.equal((await fetch(url,{headers:{'X-Rss-List':'reader-v1','If-None-Match':tag}})).status,304);
 const many=await Promise.all(Array.from({length:50},()=>fetch(url,{headers:{'X-Rss-List':'reader-v1'}}).then(r=>r.json())));assert.equal(calls,2);assert(many.every(x=>x.entries[0].assets===undefined));
 assert.equal((await fetch(url,{headers:{Cookie:'session=x'}}).then(r=>r.json())).entries[0].id,'private');
 deleted=true;generation++;const fresh=await fetch(url,{headers:{'X-Rss-List':'reader-v1','If-None-Match':tag}});assert.equal(fresh.status,200);assert.deepEqual((await fresh.json()).entries,[]);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
});
