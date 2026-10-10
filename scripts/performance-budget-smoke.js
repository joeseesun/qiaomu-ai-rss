// Installed-host acceptance. Only run in the dedicated QA vault.
if (app.vault.getName() !== 'qiaomu-home-dashboard-qa') throw Error('QA only');
const p=app.plugins.plugins['qiaomu-ai-rss']; await p.openReader();
const leaf=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0]; await leaf.loadIfDeferred();
const v=leaf.view, Api=p.api().constructor;
const original={state:p.state,persist:p.persist,api:p.api,syncDeletedArticles:p.syncDeletedArticles,saveSplit:p.saveSplit};
const checks=[]; const check=(name,pass,detail={})=>{checks.push({name,pass:!!pass,...detail});if(!pass)throw Error(name+JSON.stringify(detail));};
const reply=value=>({status:200,text:JSON.stringify(value)});
p.state=structuredClone(p.state);p.state.settings.remoteImages=false;p.state.settings.pickedSourceIds=null;
p.persist=async()=>{}; p.syncDeletedArticles=async()=>{};
v.listVersion++;v.articleVersion++; v.source='user-submitted';v.filter='all';v.query='';v.platform='all';v.renderedCount=60;
try {
 v.entries=Array.from({length:200},(_,i)=>({id:'perf-'+i,sourceId:'user-submitted',title:'性能验收文章 '+i,summary:'保留摘要、已读状态和阅读位置。',publishedTs:Date.now()-i*1000}));
 p.state.readIds=[];v.renderList();
 const initial=[...v.list.querySelectorAll('.qrs-entry')];initial[4].focus();v.list.scrollTop=100;
 let start=performance.now(); for(let i=0;i<100;i++)v.renderList();
 const after=[...v.list.querySelectorAll('.qrs-entry')];
 check('100 renders retain all 60 row elements',initial.every((row,i)=>row===after[i]),{ms:performance.now()-start});
 check('unmodified row keeps focus',v.list.ownerDocument.activeElement===initial[4]);
 p.state.readIds=['perf-0'];v.renderList();
 check('read change only replaces affected row',v.list.querySelector('.qrs-entry')!==initial[0]&&v.list.querySelectorAll('.qrs-entry')[1]===initial[1]);
 v.renderedCount=120;v.renderList();check('append keeps existing rows',v.list.querySelectorAll('.qrs-entry').length===120&&v.list.querySelectorAll('.qrs-entry')[1]===initial[1]);
 let opened; const open=v.openArticle;v.openArticle=async entry=>{opened=entry};
 v.entries=v.entries.map(entry=>({...entry,content:'fresh '+entry.id}));v.renderList();v.list.querySelectorAll('.qrs-entry')[1].click();v.openArticle=open;
 check('retained click handler uses latest entry',opened.content==='fresh perf-1');
 v.query='性能验收文章 199';v.renderList();check('search removes obsolete rows',v.list.querySelectorAll('.qrs-entry').length===1&&v.list.textContent.includes('199'));v.query='';
 let calls=0, release;let api=new Api('https://rss.qiaomu.ai',()=>{calls++;return new Promise(r=>{release=r})});
 const reads=Promise.all([api.entries(),api.entries()]);await new Promise(r=>setTimeout(r,8200));
 check('8 second stall remains one request',calls===1);release(reply({entries:[]}));await reads;
 calls=0;api=new Api('https://rss.qiaomu.ai',async()=>({status:++calls===1?502:200,text:'{"entries":[]}'}));
 start=performance.now();await api.entries();check('settled gateway failure recovers once with jitter',calls===2,{ms:performance.now()-start});
 calls=0;api=new Api('https://rss.qiaomu.ai',async()=>{calls++;return{status:503,text:'',headers:{'retry-after':'10'}}});
 await api.entries().catch(()=>{});await api.entries('other').catch(()=>{});check('overload cools down without additional transport',calls===1);
 let saves=0, finish;p.saveSplit=()=>{saves++;return new Promise(r=>{finish=r})};p.persist=original.persist;
 let settled=false;const saving=Promise.all(Array.from({length:100},()=>p.persist())).then(()=>{settled=true});await Promise.resolve();
 check('save burst writes once and waits for disk',saves===1&&!settled);finish();await saving;
 p.persist=async()=>{};p.saveSplit=original.saveSplit;
 // Reading UI uses controlled content; disk stalls are covered by the image tests.
 p.api=()=>({article:async(id,preview)=>({bundle:{entry:{...preview,content:'<p>本机性能验收正文，列表与阅读区保持一致。</p>'},rewrite:null,translation:null,fetchedAt:Date.now()},warnings:[]})});
 v.entries=v.entries.slice(0,10);v.renderList();await v.openArticle(v.entries[0],undefined,'original');
 check('real article renders after list optimizations',v.reader.querySelector('.qrs-prose')?.textContent.includes('本机性能验收正文'));
 const win=require('electron').remote.getCurrentWindow();win.show();win.focus();win.webContents.invalidate();await new Promise(r=>setTimeout(r,250));
 require('fs').writeFileSync('/tmp/qrs-performance-budget.png',(await win.webContents.capturePage()).toPNG());
 return {version:p.manifest.version,checks};
} finally {v.listVersion++;v.articleVersion++;if(v.checkpointTimer){clearTimeout(v.checkpointTimer);v.checkpointTimer=undefined;}Object.assign(p,original);v.reset();}
