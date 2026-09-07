const {execFileSync}=require('node:child_process');
const ev=code=>{const out=execFileSync('obsidian',['vault=Qiaomu RSS QA','eval','code='+code.replace(/\n/g,' ')],{encoding:'utf8'}).trim();return out?JSON.parse(out.slice(3)):null;};
ev(String.raw`(()=>{window.__channelsQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'];await p.openReader();const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
const originals={sessions:structuredClone(p.state.channelStates),last:p.state.settings.lastSource,source:v.source,bundle:v.bundle,api:p.api,sources:p.state.sources,mode:p.state.settings.defaultMode,cache:{...p.state.cache},readIds:[...p.state.readIds]};
const results=[],check=(name,ok)=>{if(!ok)throw Error(name);results.push(name)},wait=ms=>new Promise(r=>setTimeout(r,ms));
const make=(source,n)=>Array.from({length:65},(_,i)=>({id:source+'-'+i,sourceId:source,title:n+i,content:'<p>'+('Reading paragraph. '.repeat(50))+'</p>'.repeat(1)+Array.from({length:80},()=>'<p>More reading content '+('words '.repeat(30))+'</p>').join('')}));
const a=make('qa-channel-a','Alpha '),b=make('qa-channel-b','Beta ');
p.state.settings.defaultMode='original';v.channelPicker?.close(false);
p.state.sources=[...originals.sources,{id:'qa-channel-a',name:'QA Alpha'},{id:'qa-channel-b',name:'QA Beta'}];
p.api=()=>({entries:async source=>({entries:source==='qa-channel-a'?a:b,hasMore:false}),sources:async()=>({sources:p.state.sources}),article:async id=>({bundle:{entry:[...a,...b].find(e=>e.id===id),rewrite:null,translation:null,fetchedAt:Date.now()},warnings:[]})});
try{
v.selectSource('qa-channel-a');await wait(120);await v.openArticle(a[4]);v.stopRestoring();v.list.scrollTop=630;v.reader.scrollTop=880;
const aTop=v.list.scrollTop,aRead=v.reader.scrollTop;check('Fixture has scrollable list and article '+JSON.stringify({aTop,aRead,width:innerWidth,mode:v.mode,list:v.entries.length,query:v.query,filter:v.filter,body:v.reader.innerText.slice(-80)}),aTop>500&&aRead>700);
v.selectSource('qa-channel-b');await wait(120);await v.openArticle(b[3]);v.list.scrollTop=290;v.reader.scrollTop=460;
v.selectSource('qa-channel-a');await wait(120);
check('A-B-A restores exact article',v.bundle.entry.id===a[4].id);
check('A-B-A restores both scroll positions',Math.abs(v.list.scrollTop-aTop)<2&&Math.abs(v.reader.scrollTop-aRead)<2);
const article=v.reader.querySelector('.qrs-article'),version=v.articleVersion;v.pickChannel();
const panel=document.querySelector('.qrs-channel-picker'),anchor=v.channelButton.getBoundingClientRect(),rect=panel.getBoundingClientRect();
check('Desktop panel is anchored below channel button',Math.abs(rect.left-anchor.left)<3&&rect.top>=anchor.bottom&&rect.width<=350);
check('Hierarchy has sections and compact rows',panel.querySelectorAll('.qrs-channel-section').length>=2&&panel.querySelector('.qrs-channel-option').getBoundingClientRect().height<45);
const search=panel.querySelector('input');search.value='QA Alpha';search.dispatchEvent(new Event('input'));panel.querySelector('[data-channel-id="qa-channel-a"]').click();
check('Choosing current channel only dismisses panel',!document.querySelector('.qrs-channel-picker')&&v.articleVersion===version&&v.reader.querySelector('.qrs-article')===article&&v.reader.scrollTop===aRead);
v.pickChannel();const input=document.querySelector('.qrs-channel-picker input');input.value='QA Beta';input.dispatchEvent(new Event('input'));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
check('Search and Enter select channel and restore B',v.source==='qa-channel-b'&&v.bundle.entry.id===b[3].id&&v.reader.scrollTop===460);
v.saveChannel();await p.persist();const disk=await p.loadData();check('Channel checkpoints persist to vault',disk.channelStates[v.channelKey()].readerTop===460);
v.reset();await wait(150);check('View recreation restores persisted article and position',v.bundle.entry.id===b[3].id&&v.reader.scrollTop===460);
v.selectSource('qa-channel-a');await wait(50);const target=v.reader.scrollTop;const short=v.reader.querySelector('.qrs-prose');const html=short.innerHTML;short.empty();await wait(70);short.innerHTML=html;await wait(100);
check('Late content layout restores requested offset',Math.abs(v.reader.scrollTop-target)<2);
v.reader.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));v.reader.scrollTop=310;v.selectSource('qa-channel-b');v.selectSource('qa-channel-a');await wait(80);
check('User scroll replaces the old restored position',v.reader.scrollTop===310);
v.stopRestoring();v.reader.style.display='none';v.saveChannel();check('Hidden mobile reader retains its last reading offset',p.state.channelStates[v.channelKey()].readerTop===310);v.reader.style.display='';
v.list.style.display='none';v.saveChannel();check('Hidden mobile list retains its last scroll offset',p.state.channelStates[v.channelKey()].listTop===aTop);v.list.style.display='';
let finish;const oldArticle=p.api; p.api=()=>({...oldArticle(),article:()=>new Promise(resolve=>{finish=resolve;})});
void v.openArticle(a[9]);v.selectSource('qa-channel-b');finish({bundle:{entry:a[9],rewrite:null,translation:null,fetchedAt:Date.now()},warnings:[]});await wait(70);
check('Late article response cannot replace another channel',v.bundle.entry.id===b[3].id);
p.api=oldArticle;v.selectSource('qa-channel-a');await wait(150);check('Returning to interrupted article resumes loading',v.bundle.entry.id===a[9].id&&!v.articleLoading);
window.__channelsQA={results};
}finally{
v.reader.style.display='';v.list.style.display='';v.channelPicker?.close(false);if(v.checkpointTimer)clearTimeout(v.checkpointTimer);v.stopRestoring();p.api=originals.api;p.state.sources=originals.sources;p.state.settings.defaultMode=originals.mode;p.state.cache=originals.cache;p.state.readIds=originals.readIds;p.state.channelStates=originals.sessions;p.state.settings.lastSource=originals.last;v.reset();if(originals.bundle)v.showSavedArticle(originals.bundle,'original');await p.persist();
}
})().catch(e=>window.__channelsQA={error:String(e)});return true})()`);
let result;for(let i=0;i<100;i++){result=ev('JSON.stringify(window.__channelsQA)');if(result)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);}
console.log(result);if(!result||result.error)process.exitCode=1;
