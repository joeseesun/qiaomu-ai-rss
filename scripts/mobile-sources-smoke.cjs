const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const evaluate=code=>{const s=execFileSync('obsidian',['vault='+(process.env.RSS_TEST_VAULT||'qiaomu-public-install.NmoBsq'),'eval','code='+code.replace(/\n/g,' ')],{encoding:'utf8',timeout:30000});return s.trim()?JSON.parse(s.slice(3)):null;};
for(let i=0;i<40;i++){if(evaluate('JSON.stringify(!!app.plugins.plugins["qiaomu-ai-rss"]?.images)'))break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
evaluate(String.raw`(()=>{window.__mobileSourcesQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'],settings={...p.state.settings,markdownFolders:[...p.state.settings.markdownFolders]},folder='Mobile Sources QA '+Date.now();
const results=[],check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);},wait=ms=>new Promise(r=>setTimeout(r,ms));
await app.vault.createFolder(folder);const file=await app.vault.create(folder+'/clip.md','# Local clipping\n\nSelectable local paragraph.');
await p.openReader();const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view,originalBundle=v.bundle;
const mobile=document.body.hasClass('is-mobile');
try{
check('Reader command has explicit product name',app.commands.commands['qiaomu-ai-rss:open-reader'].name.includes('打开乔木 RSS 阅读器'));
p.state.settings.selectionPopup=true;
v.showSavedArticle({entry:{id:'qa-mobile-selection',sourceId:'qa',title:'Touch selection',content:'<p>Choose just these words.</p>'},rewrite:null,translation:null,fetchedAt:Date.now()},'original');
v.reader.querySelector('[data-qrs-label="更多文章操作"]').click();[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes('阅读设置')).click();
let panel=v.reader.querySelector('.qrs-reading-settings');
check('Typography has no completion or reset buttons',!!panel&&!panel.textContent.includes('完成')&&!panel.textContent.includes('恢复默认'));
const size=panel.querySelector('[data-qrs-field="正文字号"]');size.value='23';size.dispatchEvent(new Event('input'));await p.persist();
check('Typography input applies and saves immediately',p.state.settings.fontSize===23&&(await p.loadData()).settings.fontSize===23);
v.reader.querySelector('.qrs-prose').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
check('Clicking article dismisses typography',!v.reader.querySelector('.qrs-reading-settings'));
const prose=v.reader.querySelector('.qrs-prose'),range=document.createRange(),selection=document.getSelection();range.selectNodeContents(prose.querySelector('p'));selection.removeAllRanges();selection.addRange(range);
document.dispatchEvent(new Event('selectionchange'));await wait(250);
check('Selection changes alone show popup without mouse release',document.querySelectorAll('.qrs-selection-popup button').length===2);
const touchMenu=new PointerEvent('contextmenu',{bubbles:true,cancelable:true,pointerType:'touch'});prose.dispatchEvent(touchMenu);check('Touch long-press keeps native text-selection menu',!touchMenu.defaultPrevented);
check('WebKit text selection explicitly enabled',getComputedStyle(prose).webkitUserSelect==='text');selection.removeAllRanges();
v.pickChannel();await wait(100);
let prompt=document.querySelector('.qrs-channel-picker');
check('Channel uses anchored searchable choices',!!prompt&&!!prompt.querySelector('input[type=search]')&&!!prompt.querySelector('.qrs-channel-option'));
const selected=prompt.querySelector('.qrs-channel-option[aria-current=true]');
check('Selected channel keeps readable text',!!selected&&getComputedStyle(selected).color!==getComputedStyle(selected).backgroundColor);
prompt.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(100);
p.manageSubscriptions();await wait(150);let modal=document.querySelector('.qrs-center');
check('Subscription center exposes two tabs',[...modal.querySelectorAll('[role=tab]')].map(x=>x.textContent.replace(/ · \d+$/,'')).join('|')==='订阅管理|发现订阅');
modal.querySelector('[data-tab=discover]').click();await wait(150);
check('Discover renders cards inside the center',modal.querySelectorAll('.qrs-discovery-card').length>0);
check('Discover does not create a workspace tab',!app.workspace.getLeavesOfType('qiaomu-ai-rss-discovery').length);
modal.querySelector('[data-tab=library]').click();await wait(100);
modal.querySelector('.qrs-library-add').click();await wait(100);
check('Library actions live in the add menu',['发现订阅','添加本地文件夹或笔记','新建分组','导入 OPML','导出 OPML'].every(t=>[...document.querySelectorAll('.menu-item')].some(e=>e.textContent.includes(t))));
[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes('添加本地文件夹或笔记')).click();await wait(150);
[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes('添加笔记')).click();await wait(100);
prompt=[...document.querySelectorAll('.prompt')].at(-1);const input=prompt.querySelector('input');input.value=folder;input.dispatchEvent(new Event('input',{bubbles:true}));await wait(150);
const result=[...prompt.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes('/clip.md'));check('Native typeahead finds individual Markdown file',!!result);result.click();await wait(150);[...[...document.querySelectorAll('.modal')].at(-1).querySelectorAll('button')].find(x=>x.textContent==='确定').click();await wait(250);
check('Individual file added as a reading source',p.state.settings.markdownFolders.includes(file.path));
check('File source lists exactly its own article',p.vaultSources.entries(file.path).length===1&&p.vaultSources.entries(file.path)[0].markdownPath===file.path);
check('Folder source still includes its Markdown files',p.vaultSources.entries(folder).length===1);
modal.querySelector('[data-tab=discover]').click();document.body.addClass('is-mobile');modal.style.width='390px';modal.style.maxWidth='390px';await wait(100);
check('Center tabs and discovery fit 390px',modal.scrollWidth<=modal.clientWidth+1&&modal.querySelector('.qrs-center-panel:not(.qrs-hidden)').scrollWidth<=modal.querySelector('.qrs-center-panel:not(.qrs-hidden)').clientWidth+1);
window.__mobileSourcesQA={results};
}finally{
p.center?.close();document.getSelection()?.removeAllRanges();if(!mobile)document.body.removeClass('is-mobile');p.state.settings=settings;
for(const leaf of app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file?.path.startsWith(folder+'/'))){await leaf.view.save();await leaf.setViewState({type:'empty',state:{}});leaf.detach();}
await app.vault.delete(app.vault.getAbstractFileByPath(folder),true);await p.persist();v.reset();if(originalBundle)v.showSavedArticle(originalBundle,'original');
}
})().catch(e=>window.__mobileSourcesQA={error:String(e)});return true})()`);
let result;for(let i=0;i<100;i++){result=evaluate('JSON.stringify(window.__mobileSourcesQA)');if(result)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
console.log(result);if(!result||result.error)process.exitCode=1;else{fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/mobile-sources-smoke.json',JSON.stringify(result,null,2));}
