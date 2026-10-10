// Run with QMREADER_MODULES=/path/to/qmreader to use its installed Express.
const test=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os'),{join}=require('node:path');
const {middleware}=require('../public-read-cache.cjs');
const resolveExpress=()=>require(require.resolve('express',{paths:[process.env.QMREADER_MODULES||process.cwd()]}));
test('real HTTP reads share cached JSON, preserve negotiation and invalidate on disk/write changes',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'rss-cache-check-'));
 const express=resolveExpress(),app=express();let calls=0,hidden=false;
 const cache=middleware({directory});app.use(cache);
 app.get('/api/entries',(req,res)=>{calls++;res.json({entries:hidden?[]:[{id:'a',title:'A',content:'body',assets:{large:'x'.repeat(1000)},summary:'Keep'}],hasMore:true,nextCursor:'cursor'});});
 app.delete('/api/entry/a',(_req,res)=>{hidden=true;res.json({ok:true});});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const rows=await Promise.all(Array.from({length:100},()=>fetch(base+'/api/entries').then(r=>r.json())));
  assert.equal(calls,1);assert(rows.every(r=>r.entries[0].id==='a'));
  const lean=await fetch(base+'/api/entries',{headers:{'X-Rss-List':'reader-v1'}}).then(r=>r.json());
  assert.equal(lean.entries[0].assets,undefined);assert.equal(lean.nextCursor,'cursor');assert.equal(calls,2);
  await fetch(base+'/api/entries',{headers:{Cookie:'session=private'}});assert.equal(calls,3);
  writeFileSync(join(directory,'state.json'),'changed');await fetch(base+'/api/entries');assert.equal(calls,4);
  await fetch(base+'/api/entry/a',{method:'DELETE'});assert.deepEqual((await fetch(base+'/api/entries').then(r=>r.json())).entries,[]);
  console.log(JSON.stringify({concurrentReads:100,initialHandlerCalls:1,stats:cache.stats()}));
 }finally{await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
});
