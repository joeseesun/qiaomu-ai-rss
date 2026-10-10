const transport=app.plugins.plugins['qiaomu-ai-rss'].api().transport;
const results=[];
for(const lean of [true,true]){
 const started=Date.now();
 try{
  let timer;
  const response=await Promise.race([transport('https://rss.qiaomu.ai/api/entries?limit=100'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('QA network deadline 20s')),20000)})]).finally(()=>clearTimeout(timer));
  const body=JSON.parse(response.text);results.push({lean,status:response.status,ms:Date.now()-started,bytes:new TextEncoder().encode(response.text).length,count:body.entries?.length,hasAssets:!!body.entries?.[0]?.assets,origin:response.headers['x-rss-origin'],cache:response.headers['x-rss-read-cache']});
 }catch(error){results.push({lean,error:String(error),ms:Date.now()-started});}
}
return results;
