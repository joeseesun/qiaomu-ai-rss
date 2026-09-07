const {execFileSync}=require('node:child_process');
const ev=code=>{const output=execFileSync('obsidian',['vault=Qiaomu RSS QA','eval','code='+code.replace(/\n/g,' ')],{encoding:'utf8'}).trim();return output?JSON.parse(output.slice(3)):null;};
ev(`(()=>{window.__controls=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'],results=[];
const check=(name,ok)=>{if(!ok)throw Error(name);results.push(name)};
await p.openReader();const r=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0],v=r.view;
const bundle=Object.values(p.state.savedArticles)[0];v.showSavedArticle(bundle,'original');
check('Article metadata removed',!v.reader.querySelector('.qrs-article-meta')&&!!v.reader.querySelector('h1'));
const gear=v.contentEl.querySelector('.qrs-settings-button');check('Settings icon at right of filter row',!!gear&&gear.parentElement===v.filters&&gear===v.filters.lastElementChild);
gear.click();check('Gear opens plugin settings',app.setting.activeTab?.id==='qiaomu-ai-rss');app.setting.close();
p.manageSubscriptions('explore');check('Only curated and independent-blog collections remain',document.querySelectorAll('.qrs-discovery-collections button').length===2&&!document.querySelector('.qrs-discovery').textContent.includes('公众号'));p.subscriptionManager.close();
await app.workspace.revealLeaf(r);const file=await app.vault.create('Split note QA '+Date.now()+'.md','Keep existing text');
const tab=app.workspace.getLeaf('tab');await tab.openFile(file);check('Regression fixture begins in reader tab group',tab.parent===r.parent);
const original=p.appendToDailyNote;p.appendToDailyNote=async()=>({file,added:false});
try{
await app.workspace.revealLeaf(r);await p.noteArticle(bundle.entry);
const notes=app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file===file),side=notes.find(l=>l.parent!==r.parent);
check('Existing same-group note opens a separate split',!!side&&r.view===v&&r.view.containerEl.isShown());
const count=notes.length;await app.workspace.revealLeaf(r);await p.noteArticle(bundle.entry);
check('Repeated clicks reuse the adjacent split',app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file===file).length===count);
check('Existing note content preserved',await app.vault.read(file)==='Keep existing text');
}finally{p.appendToDailyNote=original;for(const l of app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file===file)){await l.view.save();await l.setViewState({type:'empty',state:{}});l.detach();}await app.vault.delete(file);await app.workspace.revealLeaf(r);}
window.__controls={results};})().catch(e=>window.__controls={error:String(e)});return true})()`);
let result;for(let i=0;i<60;i++){result=ev('JSON.stringify(window.__controls)');if(result)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
console.log(result);if(!result||result.error)process.exitCode=1;
