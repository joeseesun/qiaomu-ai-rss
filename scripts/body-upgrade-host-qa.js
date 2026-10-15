if(app.vault.getName()!=='qrs-scale-qa')throw Error('QA only');
const id='qiaomu-ai-rss',dir=app.vault.configDir+'/plugins/'+id;
const previous=app.plugins.plugins[id],state=structuredClone(previous.state),body='<p>升级前收藏的离线正文</p>';
state.settings.lastSource='local:upgrade';state.settings.remoteImages=false;state.settings.listWidth=330;state.channelStates={};
const entry={id:'upgrade-offline',sourceId:'local:upgrade',origin:'local',title:'升级验收文章',summary:'离线摘要'};
state.subscriptions=[{id:'local:upgrade',url:'https://example.com/feed',name:'升级验收订阅',group:'',entries:[entry],updatedAt:Date.now(),lastAttemptAt:Date.now(),error:'',errorCount:0,lastErrorAt:0,paused:true}];
state.favorites={ [entry.id]:{entry,rewrite:null,translation:null,fetchedAt:1} };state.cache={};state.savedArticles={};state.readIds=[entry.id];
await app.plugins.disablePlugin(id);await previous.persist();
if(await app.vault.adapter.exists(dir+'/bodies-v1'))await app.vault.adapter.rmdir(dir+'/bodies-v1',true);
await app.vault.adapter.write(dir+'/data.json',JSON.stringify(state));await app.vault.adapter.write(dir+'/content-cache.json',JSON.stringify({[entry.id]:body}));
const read=app.vault.adapter.read.bind(app.vault.adapter),reads=[];app.vault.adapter.read=async path=>{reads.push(path);return read(path);};
const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(JSON.stringify({name,checks,reads}));};
try{
 await app.plugins.loadManifests();await app.plugins.enablePlugin(id);const p=app.plugins.plugins[id];
 check('startup does not read any body cache',!reads.some(path=>path.includes('content-cache')||path.includes('bodies-v1')));
 check('settings favorites and read markers preserved',p.state.settings.listWidth===330&&p.state.readIds.includes(entry.id)&&!!p.state.favorites[entry.id]);
 check('legacy body loads on demand',(await p.hydrateEntry(p.state.subscriptions[0].entries[0])).content===body);
 await p.persist();check('migration completion marker exists',await app.vault.adapter.exists(dir+'/bodies-v1/ready.json'));
 await app.plugins.disablePlugin(id);await p.persist();reads.length=0;await app.plugins.enablePlugin(id);
 const next=app.plugins.plugins[id];check('restart still loads metadata only',!reads.some(path=>path.includes('content-cache')||path.includes('bodies-v1')));
 reads.length=0;check('sharded offline body survives restart',(await next.hydrateEntry(next.state.subscriptions[0].entries[0])).content===body);
 check('body lookup reads one shard',reads.length===1&&reads[0].includes('bodies-v1'));
 await next.openReader();const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;await v.openArticle(next.state.subscriptions[0].entries[0]);
 check('offline article renders after upgrade',v.reader.textContent.includes('升级前收藏的离线正文'));
 return{checks};
}finally{app.vault.adapter.read=read;}
