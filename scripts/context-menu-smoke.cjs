const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const evaluate=code=>{const s=execFileSync('obsidian',['vault=Qiaomu RSS QA','eval','code='+code.replace(/\n/g,' ')],{encoding:'utf8'});return s.trim()?JSON.parse(s.slice(3)):null;};
evaluate(String.raw`(()=>{window.__contextQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'],folder='Context QA '+Date.now(),results=[];
const check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);};
await app.vault.createFolder(folder);
const a=await app.vault.create(folder+'/A.md','First note'),b=await app.vault.create(folder+'/B.md','Second note\n<!-- qrs-article:legacy -->\n');
const oldSaved={...p.state.savedArticles},oldCache={...p.state.cache};
await p.openReader();const reader=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0],v=reader.view,oldBundle=v.bundle;
try{
const leaf=app.workspace.getLeaf('split','vertical');await leaf.openFile(a);await app.workspace.revealLeaf(leaf);
await leaf.openFile(b);await app.workspace.revealLeaf(leaf);await new Promise(r=>setTimeout(r,600));
await new Promise(r=>setTimeout(r,100));await p.dailyNoteWrite;check('Opening old note removes internal markers',!leaf.view.editor.getValue().includes('qrs-article:'));
leaf.view.editor.setValue('Unsaved draft must survive');
await app.workspace.revealLeaf(reader);
check('Most recently active note is remembered',p.currentNote()===b);
const entry={id:'context-qa',origin:'local',sourceId:'qa',title:'Context title',link:'https://example.com/article',content:'<p>First excerpt</p><p>Second excerpt</p>'};
v.showSavedArticle({entry,rewrite:null,translation:null,fetchedAt:Date.now()},'original');
const prose=v.reader.querySelector('.qrs-prose');
const range=document.createRange();range.selectNodeContents(prose.querySelector('p'));const sel=document.getSelection();sel.removeAllRanges();sel.addRange(range);
prose.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:450,clientY:220}));
const items=[...document.querySelectorAll('.menu-item')];
check('Right-click offers current note and Daily Note',items.some(e=>e.textContent.includes('当前笔记：B'))&&items.some(e=>e.textContent.includes('今日日记')));
items.find(e=>e.textContent.includes('当前笔记：B')).click();
await new Promise(r=>setTimeout(r,100));await p.dailyNoteWrite;
let content=await app.vault.read(b);
check('Selected excerpt and pending draft preserved',content.includes('Unsaved draft must survive')&&content.includes('First excerpt')&&!content.includes('Second excerpt'));
check('Reader link and original link included',content.includes('obsidian://qiaomu-ai-rss?')&&content.includes('[原文]'));
check('Other note untouched',(await app.vault.read(a))==='First note');
await p.appendToDailyNote(entry,'Second excerpt','original',b);
content=await app.vault.read(b);
check('Same article groups excerpts under one source',(content.match(/\[原文\]/g)||[]).length===1&&content.includes('Second excerpt'));
sel.removeAllRanges();
prose.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:450,clientY:220}));
[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes('当前笔记：B')).click();await new Promise(r=>setTimeout(r,100));await p.dailyNoteWrite;
check('No-selection capture avoids duplicate header',(await app.vault.read(b))===content);
const popupSetting=p.state.settings.selectionPopup,noteArticle=p.noteArticle;p.state.settings.selectionPopup=true;
try{
const showPopup=()=>{range.selectNodeContents(prose.querySelectorAll('p')[1]);sel.removeAllRanges();sel.addRange(range);prose.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return document.querySelector('.qrs-selection-popup');};
let popup=showPopup();const buttons=[...popup.querySelectorAll('button')];
check('Popup has two labeled icon-only actions',buttons.length===2&&buttons.every(b=>b.querySelector('svg')&&b.getAttribute('aria-label')&&!b.textContent.trim()));
check('Popup current-note target is enabled',!buttons[1].disabled&&buttons[1].getAttribute('aria-label').includes('B'));
buttons[1].click();await new Promise(r=>setTimeout(r,100));await p.dailyNoteWrite;
check('Popup current-note append preserves grouped captures',(await app.vault.read(b))===content);
p.noteArticle=(entry,text,mode)=>p.appendToDailyNote(entry,text,mode,a);
popup=showPopup();popup.querySelector('button').click();await new Promise(r=>setTimeout(r,100));await p.dailyNoteWrite;
check('Popup daily action uses daily-note flow',(await app.vault.read(a)).includes('Second excerpt'));
check('New captures contain no internal marker',!(await app.vault.read(a)).includes('qrs-article:'));
}finally{p.noteArticle=noteArticle;p.state.settings.selectionPopup=popupSetting;sel.removeAllRanges();}

app.setting.open();app.setting.openTabById('qiaomu-ai-rss');
check('Service address removed from settings',!app.setting.activeTab.containerEl.textContent.includes('服务地址'));app.setting.close();
window.__contextQA={results};
}finally{
for(const leaf of app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file?.path.startsWith(folder+'/'))){await leaf.view.save();await leaf.setViewState({type:'empty',state:{}});leaf.detach();}
await app.vault.delete(app.vault.getAbstractFileByPath(folder),true);
p.state.savedArticles=oldSaved;p.state.cache=oldCache;await p.persist();if(oldBundle)v.showSavedArticle(oldBundle,'original');
}
})().catch(e=>window.__contextQA={error:String(e)});return true})()`);
let result;for(let i=0;i<120;i++){result=evaluate('JSON.stringify(window.__contextQA)');if(result)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
console.log(result);if(!result||result.error)process.exitCode=1;
else{fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/context-menu-smoke.json',JSON.stringify(result,null,2));}
