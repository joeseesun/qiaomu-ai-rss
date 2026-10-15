if(app.vault.getName()!=='qrs-scale-qa')throw Error('QA only');
const p=app.plugins.plugins['qiaomu-ai-rss'];await p.openReader();
const leaf=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0],v=leaf.view;
const old={state:p.state,persist:p.persist,load:p.images.load,open:v.openArticle};
const checks=[];const check=(name,pass,detail={})=>{checks.push({name,pass:!!pass,...detail});if(!pass)throw Error(JSON.stringify(checks));};
const wait=()=>new Promise(r=>setTimeout(r,150));
p.state=structuredClone(old.state);p.persist=async()=>{};p.state.settings.remoteImages=false;p.state.settings.pickedSourceIds=null;
v.listVersion++;v.articleVersion++;v.status.setText('');v.source='@local';v.filter='all';v.query='';v.platform='all';
try{
 p.state.subscriptions=Array.from({length:500},(_,f)=>({id:`local:${f}`,name:`订阅 ${f}`,url:`https://example.com/${f}`,entries:Array.from({length:50},(_,e)=>({id:`qa-${f}-${e}`,sourceId:`local:${f}`,origin:'local',title:`订阅 ${f}：文章 ${e}`,summary:'持续更新时保持阅读位置，大列表只绘制可见区域。',content:'<p>离线正文</p>',publishedTs:1792065600000-e*1000-f}))}));
 v.resetWindow();v.entries=v.localEntries();v.list.scrollTop=0;v.renderList();await wait();
 check('first viewport is bounded',v.listRows.size<50,{rows:v.listRows.size});
 v.list.scrollTop=100000;v.renderList(true);await wait();
 const at=v.virtual.indexAt(v.list.scrollTop),anchor=v.virtual.idAt(at),delta=v.list.scrollTop-v.virtual.offset(at);
 const fresh={id:'qa-new',sourceId:'local:0',origin:'local',title:'新到达文章',summary:'新增不会打断阅读',publishedTs:1792065601000};
 p.state.subscriptions[0].entries=[fresh,...p.state.subscriptions[0].entries];v.entries=v.localEntries();v.renderList();await wait();
 const next=v.virtual.position(anchor);check('refresh preserves article and pixel offset',Math.abs(v.list.scrollTop-v.virtual.offset(next)-delta)<2,{anchor,delta,now:v.list.scrollTop-v.virtual.offset(next)});
 check('deep scroll recycles rows',v.listRows.size<50,{rows:v.listRows.size});
 v.list.scrollTop=0;v.renderList(true);await wait();const row=[...v.listRows.values()][2].row;row.focus();v.renderList();
 check('unchanged row retains focus',document.activeElement===row);
 const tail=[...v.listRows.values()].at(-1).row,tailIndex=v.virtual.position(tail.dataset.entryId);tail.focus();tail.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 check('Tab crosses virtual window boundary',document.activeElement?.dataset.entryId===v.virtual.idAt(tailIndex+1));
 v.searchInput.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));v.searchInput.value='订阅 499：文章 49';v.searchInput.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));await wait();
 check('IME does not filter unfinished composition',v.query==='');
 v.searchInput.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await wait();
 check('search finds offscreen article',v.listRows.size===1&&v.list.textContent.includes('499：文章 49'));
 v.searchInput.value='';v.searchInput.dispatchEvent(new InputEvent('input',{bubbles:true}));await wait();check('clear search restores viewport',v.query===''&&v.listRows.size<50);
 let loads=0;const loaded=new Set();p.images.load=async url=>{loads++;loaded.add(url);return new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});};
 p.state.settings.remoteImages=true;v.entries=v.entries.map(e=>({...e,image:`https://example.com/${e.id}.png`}));v.renderList();await wait();
 check('thumbnails load only near viewport',loads>0&&loads<v.listRows.size,{loads,rows:v.listRows.size});
 const beforeLoads=loads;v.list.scrollTop=100000;v.renderList(true);await wait();check('scroll starts newly visible images',loads>beforeLoads);
 p.state.settings.remoteImages=false;v.query='';v.list.scrollTop=0;v.renderList();
 v.source='local:0';v.entries=p.state.subscriptions[0].entries;v.resetWindow();v.renderChannel();v.renderList();await v.openArticle(v.entries[1]);
 check('local article remains readable',v.reader.textContent.includes('离线正文'));
 const electron=require('electron'),fs=require('fs'),win=electron.remote.getCurrentWindow(),size=win.getSize();
 const wasDark=document.body.classList.contains('theme-dark');
 try {
  win.setSize(1200,800);document.body.classList.remove('theme-dark');document.body.classList.add('theme-light');await wait();
  fs.writeFileSync('/tmp/qrs-scale-light.png',(await win.webContents.capturePage()).toPNG());
  document.body.classList.remove('theme-light');document.body.classList.add('theme-dark');await wait();fs.writeFileSync('/tmp/qrs-scale-dark.png',(await win.webContents.capturePage()).toPNG());
  const leftCollapsed=app.workspace.leftSplit.collapsed;app.workspace.leftSplit.collapse();win.setSize(440,800);await wait();fs.writeFileSync('/tmp/qrs-scale-narrow.png',(await win.webContents.capturePage()).toPNG());
  if(!leftCollapsed)app.workspace.leftSplit.expand();
  check('narrow reader has no horizontal overflow',v.contentEl.scrollWidth<=v.contentEl.clientWidth+2,{width:v.contentEl.clientWidth,scroll:v.contentEl.scrollWidth});
 }finally{win.setSize(...size);document.body.classList.toggle('theme-dark',wasDark);document.body.classList.toggle('theme-light',!wasDark);}
 return {checks,samples:v.performanceSamples().slice(-8)};
}finally{v.listVersion++;v.articleVersion++;p.state=old.state;p.persist=old.persist;p.images.load=old.load;v.openArticle=old.open;v.reset();}
