const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
function evaluate(code) {
  const out=execFileSync('obsidian',['vault=Qiaomu RSS QA','eval','code='+code.replace(/\n/g,' ')],{encoding:'utf8',timeout:30000});
  return out.trim()?JSON.parse(out.slice(3)):null;
}
evaluate(String.raw`(()=>{window.__vaultQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'],folder='RSS folder QA 010';
if(app.vault.getAbstractFileByPath(folder))throw Error('QA fixture already exists');
const original={...p.state.settings,markdownFolders:[...p.state.settings.markdownFolders]},api=p.api;
const results=[],check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);};
await app.vault.createFolder(folder);await app.vault.createFolder(folder+'/nested');
await app.vault.create(folder+'/clip.md','---\ntitle: Local clipping\nsource: https://example.com/original\n---\n\n# Clip\n\nLocal **Markdown** paragraph\n\n[[nested/second]]\n\n'+('Long article paragraph.\n\n'.repeat(100)));
await app.vault.create(folder+'/nested/second.md','Second local article');
await new Promise(r=>setTimeout(r,700));
try {
app.setting.open();app.setting.openTabById('qiaomu-ai-rss');
const tab=app.setting.activeTab,doc=tab.containerEl.ownerDocument;
const row=name=>[...tab.containerEl.querySelectorAll('.setting-item')].find(el=>el.querySelector('.setting-item-name')?.textContent===name);
check('Popup is disabled by default',p.state.settings.selectionPopup===false);
row('正文字体').querySelector('select').value='serif';row('正文字体').querySelector('select').dispatchEvent(new doc.defaultView.Event('change'));
row('正文字号').querySelector('select').value='21';row('正文字号').querySelector('select').dispatchEvent(new doc.defaultView.Event('change'));
row('选中文字时显示摘录浮层').querySelector('.checkbox-container').click();
check('Native settings toggle enables popup',p.state.settings.selectionPopup===true);
row('选中文字时显示摘录浮层').querySelector('.checkbox-container').click();
check('Native settings toggle disables popup',p.state.settings.selectionPopup===false);
check('Backend typography changes shared state',p.state.settings.fontFamily==='serif'&&p.state.settings.fontSize===21);
row('阅读文件夹').querySelector('button').click();
await new Promise(r=>setTimeout(r,100));
const prompt=doc.querySelector('.prompt')||document.querySelector('.prompt'),input=prompt?.querySelector('input');
check('Native searchable folder picker opens',!!input);
input.value=folder;input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));
await new Promise(r=>setTimeout(r,200));
const item=[...prompt.querySelectorAll('.suggestion-item')].find(el=>el.textContent.trim()===folder);
check('Typeahead finds vault folder',!!item);item.click();
await new Promise(r=>setTimeout(r,200));app.setting.close();
const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
check('Folder selection immediately activates reader source',v.source==='@vault:'+folder);
p.api=()=>{throw Error('Vault source tried network API');};
await v.loadEntries();
check('Local source recursively lists Markdown without API',v.entries.length===2);
await v.openArticle(v.entries.find(e=>e.title==='Local clipping'));
await new Promise(r=>setTimeout(r,200));
check('Native Markdown renders and frontmatter is excluded',v.reader.querySelector('.qrs-prose strong')?.textContent==='Markdown'&&!v.reader.querySelector('.qrs-prose').textContent.includes('source:'));
check('Internal Markdown links retain native behavior',!!v.reader.querySelector('.qrs-prose a.internal-link'));
const select=()=>{const r=document.createRange(),s=document.getSelection();r.selectNodeContents(v.reader.querySelector('.qrs-prose p'));s.removeAllRanges();s.addRange(r);v.reader.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));};
select();check('Disabled selection creates no popup',!document.querySelector('.qrs-selection-popup'));
p.state.settings.selectionPopup=true;select();check('Opt-in shows popup',!!document.querySelector('.qrs-selection-popup'));
p.state.settings.selectionPopup=false;p.refreshPreferences();check('Turning off dismisses existing popup',!document.querySelector('.qrs-selection-popup'));
v.reader.querySelector('[data-qrs-label="阅读设置"]').click();
v.reader.scrollTop=900;await new Promise(r=>setTimeout(r,100));
const panel=v.reader.querySelector('.qrs-reading-settings').getBoundingClientRect(),toolbar=v.reader.querySelector('.qrs-reader-toolbar').getBoundingClientRect();
check('Appearance panel stays anchored while article scrolls',Math.abs(panel.top-toolbar.bottom)<2&&panel.top>=0);
const data=await p.loadData();check('Folders and appearance are persisted',data.settings.markdownFolders.includes(folder)&&data.settings.fontSize===21);
await app.vault.modify(app.vault.getAbstractFileByPath(folder+'/nested/second.md'),'Changed local body');
await v.openArticle(v.entries.find(e=>e.markdownPath.endsWith('second.md')));
check('Reopening reads modified Markdown',v.bundle.entry.markdown==='Changed local body');
window.__vaultQA={results};
}finally {
p.api=api;p.state.settings=original;
for(const key of Object.keys(p.state.cache))if(key.startsWith('vault:'+folder))delete p.state.cache[key];
p.state.readIds=p.state.readIds.filter(id=>!id.startsWith('vault:'+folder));
await p.persist();p.resetViews();
await app.vault.delete(app.vault.getAbstractFileByPath(folder),true);
app.setting.close();
}
})().catch(e=>window.__vaultQA={error:String(e)});return true})()`);
let result;
for(let i=0;i<120;i++){
 result=evaluate('JSON.stringify(window.__vaultQA)');
 if(result)break;
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);
}
console.log(result);
if(!result||result.error)process.exitCode=1;
else{fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/vault-source-smoke.json',JSON.stringify(result,null,2));}
