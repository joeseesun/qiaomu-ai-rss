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
evaluate(`(()=>{window.__qrsCaptureQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'];await p.openReader();
const popupEnabled=p.state.settings.selectionPopup;p.state.settings.selectionPopup=true;
const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
const results=[],check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);};
const bundle={entry:{id:'qa-capture',sourceId:'qa',origin:'local',title:'Selection QA',link:'https://example.com/qa',content:'<p>Selection capture QA paragraph.</p><p>Second paragraph.</p>'},rewrite:null,translation:null,fetchedAt:Date.now()};
v.showSavedArticle(bundle,'original');
const prose=v.reader.querySelector('.qrs-prose'),range=document.createRange(),sel=document.getSelection();
range.selectNodeContents(prose.querySelector('p'));sel.removeAllRanges();sel.addRange(range);
prose.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
const popup=document.querySelector('.qrs-selection-popup'),rect=popup?.getBoundingClientRect();
check('Selection popup follows selected article text',!!popup&&rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight);
const original=p.noteArticle;let captured;
p.noteArticle=async(...args)=>{captured=await original.apply(p,args);return captured;};
try {
popup.querySelector('button').click();
for(let i=0;i<100&&!captured;i++)await new Promise(r=>setTimeout(r,100));
check('Capture appends through real Daily Note action',!!captured);
const text=await app.vault.read(captured.file);
check('Daily Note uses paragraphs and internal link',text.includes('Selection capture QA paragraph')&&text.includes('obsidian://qiaomu-ai-rss?')&&!text.includes('- [Selection QA]'));
check('Daily Note opens beside reader',app.workspace.getLeavesOfType('markdown').some(l=>l.view.file?.path===captured.file.path)&&!!v);
check('Popup closes after capture',!document.querySelector('.qrs-selection-popup'));
const again=await p.appendToDailyNote(bundle.entry,'Selection capture QA paragraph.','original');
check('Repeated excerpt is not duplicated',!again.added);
delete p.state.cache['qa-capture'];
await p.openSavedArticle('local|qa-capture','original');
check('Internal return survives recent-cache eviction',v.bundle.entry.id==='qa-capture'&&v.reader.textContent.includes('Second paragraph.'));
range.selectNodeContents(v.reader.querySelector('.qrs-prose p'));sel.removeAllRanges();sel.addRange(range);
v.reader.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',bubbles:true}));
check('Keyboard selection exposes action',!!document.querySelector('.qrs-selection-popup'));
document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
check('Escape dismisses action',!document.querySelector('.qrs-selection-popup'));
sel.removeAllRanges();
window.__qrsCaptureQA={results};
}finally{p.noteArticle=original;p.state.settings.selectionPopup=popupEnabled;}
})().catch(error=>window.__qrsCaptureQA={error:String(error)});return JSON.stringify(true);})()`);
let result;
for(let i=0;i<120;i++) {
  result=evaluate('JSON.stringify(window.__qrsCaptureQA)');
  if(result)break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);
}
if(!result||result.error)throw Error(result?.error||'Capture test timed out');
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/capture-smoke.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
