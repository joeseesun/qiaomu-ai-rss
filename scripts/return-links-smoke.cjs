const { execFileSync } = require('node:child_process');
const evaluate = code => JSON.parse(execFileSync('obsidian', ['vault=Qiaomu RSS QA', 'eval', 'code=' + code.replace(/\n/g, ' ')], { encoding: 'utf8' }).trim().slice(3));
evaluate(`(()=>{window.__returnQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'],id=Object.keys(p.state.savedArticles)[0],bundle=p.state.savedArticles[id],results=[];
const check=(name,value)=>{if(!value)throw Error(name);results.push(name)};
const name='Return link QA '+Date.now()+'.md';
const url='obsidian://qiaomu-ai-rss?'+new URLSearchParams({vault:app.vault.getName(),article:id,mode:'original'}).toString().replace(/\\+/g,'%20');
const file=await app.vault.create(name,'[Return article](<'+url+'>)');
const leaf=app.workspace.getLeaf('split','vertical');
try{
await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:name,mode:'preview'}});
await new Promise(r=>setTimeout(r,500));
let reader=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0];
check('Only RSS native header is hidden',getComputedStyle(reader.view.containerEl.querySelector('.view-header')).display==='none'&&getComputedStyle(leaf.view.containerEl.querySelector('.view-header')).display!=='none');
const link=leaf.view.containerEl.querySelector('a[href^="obsidian://qiaomu-ai-rss"]');
check('Preview produces article link',!!link);
reader.view.bundle=null;
const event=new MouseEvent('click',{bubbles:true,cancelable:true});link.dispatchEvent(event);
await new Promise(r=>setTimeout(r,500));
check('Click stays inside Obsidian',event.defaultPrevented);
check('Click returns to exact captured article',reader.view.bundle?.entry.id===bundle.entry.id);
await reader.setViewState({type:'empty',state:{}});reader.detach();
await app.workspace.revealLeaf(leaf);link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
await new Promise(r=>setTimeout(r,800));reader=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0];
check('Click recreates closed reader with exact article',reader?.view.bundle?.entry.id===bundle.entry.id);
await leaf.setViewState({type:'markdown',state:{file:name,mode:'source',source:false}});
await app.workspace.revealLeaf(leaf);await new Promise(r=>setTimeout(r,500));
const liveLink=leaf.view.containerEl.querySelector('.cm-link');
check('Live Preview uses editor link span',!!liveLink);
reader.view.bundle=null;const liveEvent=new MouseEvent('click',{bubbles:true,cancelable:true});liveLink.dispatchEvent(liveEvent);
await new Promise(r=>setTimeout(r,500));
check('Live Preview click returns directly to article',liveEvent.defaultPrevented&&reader.view.bundle?.entry.id===bundle.entry.id);
window.__returnQA={results};
}finally{await leaf.setViewState({type:'empty',state:{}});leaf.detach();await app.vault.delete(file);}
})().catch(e=>window.__returnQA={error:String(e)});return true})()`);
let result;for(let i=0;i<60;i++){result=evaluate('JSON.stringify(window.__returnQA)');if(result)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
console.log(result);if(!result||result.error)process.exitCode=1;
