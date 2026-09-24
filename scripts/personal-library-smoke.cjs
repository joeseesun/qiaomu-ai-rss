const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const vault=process.env.RSS_TEST_VAULT||'qiaomu-public-install.NmoBsq';
if(vault==='rockfish')throw Error('Use a disposable vault for mutation fixtures');
const cli=(...args)=>execFileSync('obsidian',[`vault=${vault}`,...args],{encoding:'utf8',timeout:30000});
const ev=code=>{const out=cli('eval','code='+code.replace(/\n/g,' '));return JSON.parse(out.slice(out.indexOf('=> ')+3));};
cli('dev:cdp','method=Emulation.clearDeviceMetricsOverride','params={}');
ev(`(()=>{window.__libraryQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'];if(app.vault.getName()!==${JSON.stringify(vault)})throw Error('Wrong vault');
const original=structuredClone(p.state),api=p.api,results=[],folder='Library QA '+Date.now();
const check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);window.__libraryQAStep=name;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn)=>{for(let i=0;i<160;i++){if(fn())return;await wait(100);}throw Error('Timed out');};
const modal=()=>[...document.querySelectorAll('.modal')].at(-1);
const click=(root,text)=>{const b=[...root.querySelectorAll('button')].find(x=>x.textContent===text);if(!b)throw Error('Missing button '+text);b.click();};
const input=(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
try{
 p.state.settings.remoteImages=false;p.state.collapsedGroups=[];
 await p.openDiscovery();await wait(200);const d={contentEl:p.center.panels.discover.el};
 check('Discovery opens in the center dialog, not a tab',!!document.querySelector('.qrs-center')&&!app.workspace.getLeavesOfType('qiaomu-ai-rss-discovery').length);
 click(d.contentEl,'返回推荐');check('Discovery starts with six mixed recommendations',d.contentEl.querySelectorAll('.qrs-discovery-card').length===6);
 check('Recommended plus three discovery types',d.contentEl.querySelectorAll('[data-collection]').length===4);
 d.contentEl.querySelector('[data-collection=blogs]').click();
 check('Blogs and other sources are merged and paged',d.contentEl.querySelector('.qrs-discovery-note').textContent.includes('已去重')&&!d.contentEl.querySelector('.qrs-discovery-filters select')&&d.contentEl.querySelectorAll('.qrs-discovery-card').length===24);
 input(d.contentEl.querySelector('input[type=search]'),'Anthropic');
 check('Search includes Tidings metadata',d.contentEl.querySelector('.qrs-discovery-grid').textContent.includes('Anthropic'));
 await p.openDiscovery();check('Discovery reuses the open dialog and query',document.querySelectorAll('.qrs-center').length===1&&p.center.panels.discover.el===d.contentEl&&d.contentEl.querySelector('input[type=search]').value==='Anthropic');
 click(d.contentEl.querySelector('.qrs-discovery-actions'),'导入 OPML');
 const xml='<opml version="2.0"><body><outline text="QA AI"><outline text="QA One" xmlUrl="https://example.org/library-qa-one"/><outline text="QA Two" xmlUrl="https://example.org/library-qa-two"/></outline><outline text="QA Other" xmlUrl="https://example.org/library-qa-other"/></body></opml>';
 input(modal().querySelector('textarea'),xml);
 check('OPML preview offers three selected items',modal().querySelectorAll('.qrs-opml-row input:checked').length===3);
 click(modal(),'清空选择');input(modal().querySelector('input[type=search]'),'QA AI');click(modal(),'选择筛选结果');click(modal(),'导入 2 个订阅');
 await until(()=>p.state.subscriptions.some(f=>f.name==='QA Two')&&!document.querySelector('.qrs-opml-selection'));
 check('Only selected OPML items imported',p.state.subscriptions.filter(f=>f.url.includes('/library-qa-')).length===2);
 check('Imported groups registered',p.state.subscriptionGroups.some(g=>g.name==='QA AI'));
 await app.vault.createFolder(folder);await app.vault.create(folder+'/note.md','# QA\n\nLocal source');await p.addLocalSource(folder);
 p.api=()=>({...api.call(p),podcastEpisodes:async()=>({entries:[{id:'qa-podcast-entry',sourceId:'podscribe-library-qa',title:'QA episode'}]})});
 await p.followPodcast('podscribe-library-qa','QA Podcast',false);p.api=api;
 p.manageSubscriptions();await wait(300);const lib=p.center.panels.library.el;
 check('Library page contains RSS, podcast, and local folder',lib.textContent.includes('QA One')&&lib.textContent.includes('QA Podcast')&&lib.textContent.includes(folder));
 check('Library tab shares the dialog with discovery',document.querySelectorAll('.qrs-center').length===1&&!lib.classList.contains('qrs-hidden')&&d.contentEl.classList.contains('qrs-hidden')&&!app.workspace.getLeavesOfType('qiaomu-ai-rss-library').length);
 lib.querySelector('.qrs-library-add').click();await wait(50);[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes('新建分组')).click();input(modal().querySelector('input'),'QA Mixed');click(modal(),'保存');await until(()=>p.state.subscriptionGroups.some(g=>g.name==='QA Mixed'));await wait(100);
 const group=p.state.subscriptionGroups.find(g=>g.name==='QA Mixed');
 const manager=lib;
 for(const row of manager.querySelectorAll('.qrs-subscription-row'))if(row.textContent.includes('QA One')||row.textContent.includes('QA Podcast')||row.textContent.includes(folder)){const c=row.querySelector('input[type=checkbox]');c.click();}
 click(manager,'移动到分组');const select=modal().querySelector('select');select.value=group.id;select.dispatchEvent(new Event('change'));click(modal(),'确定');
 await until(()=>Object.values(p.state.sourceMeta).filter(m=>m.groupId===group.id).length===3);
 check('Bulk move includes all source types',Object.values(p.state.sourceMeta).filter(m=>m.groupId===group.id).length===3);
 await wait(100);
 const menuButton=[...document.querySelectorAll('.qrs-group-header')].find(e=>e.textContent.includes('QA Mixed')).querySelector('[data-qrs-label]');menuButton.click();await wait(50);
 const menuItem=text=>[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes(text));
 menuItem('重命名').click();input(modal().querySelector('input'),'QA Renamed');click(modal(),'保存');await until(()=>[...document.querySelectorAll('.qrs-group-header')].some(e=>e.textContent.includes('QA Renamed')));
 check('Group rename keeps stable source membership',Object.values(p.state.sourceMeta).filter(m=>m.groupId===group.id).length===3);
 [...document.querySelectorAll('.qrs-group-header')].find(e=>e.textContent.includes('QA Renamed')).querySelector('[data-qrs-label]').click();await wait(50);menuItem('删除分组').click();click(modal(),'确定');await until(()=>!p.state.subscriptionGroups.some(g=>g.id===group.id));
 check('Deleting group keeps all sources and actual files',p.state.settings.followedPodcasts.includes('podscribe-library-qa')&&p.state.settings.markdownFolders.includes(folder)&&!!app.vault.getAbstractFileByPath(folder+'/note.md'));
 check('Library tab label carries no duplicate count',document.querySelector('.qrs-center [data-tab=library]').textContent==='订阅管理');p.center.close();await p.readSubscriptions();const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
 
 check('Personal reader exposes podcast and folder navigation',v.contentEl.querySelector('.qrs-personal-sources').textContent.includes('QA Podcast')&&v.contentEl.querySelector('.qrs-personal-sources').textContent.includes(folder));
 v.pickChannel();await wait(100);check('Picker groups Qiaomu picks and my subscriptions',[...document.querySelectorAll('.qrs-channel-section')].map(e=>e.textContent).join('|')==='乔木精选|我的订阅'&&!!document.querySelector('[data-channel-id="@qiaomu:微信公众号"]'));
 const before=v.source;document.querySelector('.qrs-channel-manage').click();await wait(200);check('Manage button opens the center and preserves reading channel',!!document.querySelector('.qrs-center')&&!document.querySelector('.qrs-channel-picker')&&v.source===before);p.center.close();
 await p.openReader();v.showSavedArticle({entry:{id:'qa-title',sourceId:'qa',origin:'local',title:'Original title link',link:'https://example.org/original',content:'<p>Article</p>'},rewrite:null,translation:null,fetchedAt:Date.now()},'original');
 check('Article title links to original',v.contentEl.querySelector('h1 a')?.href==='https://example.org/original');
 v.contentEl.querySelector('[data-qrs-label="更多文章操作"]').click();check('More menu still opens original',!!menuItem('打开原文'));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 await p.persist();const saved=await p.loadData();check('New state persists',saved.libraryVersion===1&&saved.settings.followedPodcasts.includes('podscribe-library-qa'));
 window.__libraryQA={results,version:p.manifest.version,vault:app.vault.getName()};
}finally{
 p.api=api;p.center?.close();p.state=original;await p.persist();
 const fixture=app.vault.getAbstractFileByPath(folder);if(fixture)await app.vault.delete(fixture,true);
 p.resetViews();p.refreshDiscovery();
}
})().catch(e=>window.__libraryQA={error:String(e),after:window.__libraryQAStep,stack:e.stack});return true})()`);
let result;for(let i=0;i<160;i++){result=ev('JSON.stringify(window.__libraryQA)');if(result)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}
console.log(JSON.stringify(result,null,2));fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/personal-library-smoke.json',JSON.stringify(result,null,2));if(!result||result.error)process.exitCode=1;
