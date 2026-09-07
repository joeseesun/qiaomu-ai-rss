import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const vault = process.env.RSS_TEST_VAULT || 'Qiaomu RSS QA';
const evaluate = code => {
  const output = execFileSync('obsidian', [`vault=${vault}`, 'eval', `code=${code.replace(/\n/g, " ")}`], { encoding: 'utf8', timeout: 30000 });
  if (!output.trim()) return null;
  return JSON.parse(output.slice(3));
};
for (let i=0;i<60;i++) {
  if(evaluate('JSON.stringify(!!app.plugins.plugins["qiaomu-ai-rss"]?.fonts)')) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);
}
evaluate(`(()=>{window.__qrsFontQA=null;void(async()=>{
  const p=app.plugins.plugins['qiaomu-ai-rss'],v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
  if(app.vault.getName()!==${JSON.stringify(vault)})throw Error('Wrong vault');
  const previous=p.state.settings.fontFamily;
  const families={sourceHanSerif:'QRS Source Han Serif',sourceHanSans:'QRS Source Han Sans',wenkai:'QRS WenKai',zhenkai:'QRS ZhenKai',fangsong:'QRS Fangsong'};
  const results=[];
  try {
    if(!v.bundle)await v.openArticle(p.state.entries[0]);
    v.appearanceOpen=true;v.renderReader(true);
    const select=document.querySelector('[data-qrs-field="正文字体"]');
    if(select.options.length!==7)throw Error('Missing font choices');
    const article=document.querySelector('.qrs-article');
    for(const [id,family] of Object.entries(families)){
      select.value=id;select.dispatchEvent(new Event('change'));
      await p.fonts.load(document,id);
      const face=[...document.fonts].find(face=>face.family===family);
      const applied=getComputedStyle(document.querySelector('.qrs-prose')).fontFamily.includes(family);
      if(face?.status!=='loaded'||!applied||document.querySelector('.qrs-article')!==article)throw Error('Font failed: '+id);
      results.push({id,loaded:true,applied:true,articlePreserved:true});
    }
    await p.persist();
    if((await p.loadData()).settings.fontFamily!=='fangsong')throw Error('Font not saved');
    window.__qrsFontQA={results,persisted:true};
  } finally {p.state.settings.fontFamily=previous;await p.persist();v.applyAppearance();}
})().catch(error=>window.__qrsFontQA={error:String(error)});return JSON.stringify(true);})()`);
let result;
for(let i=0;i<120;i++) {
  result=evaluate('JSON.stringify(window.__qrsFontQA)');
  if(result)break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);
}
if(!result||result.error)throw Error(result?.error||'Font test timed out');
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/font-smoke.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
