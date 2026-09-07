import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const vault = process.env.RSS_TEST_VAULT || 'Qiaomu RSS QA';
function evaluate(code) {
  const output = execFileSync('obsidian', [`vault=${vault}`, 'eval', `code=${code}`], { encoding: 'utf8', timeout: 30000 });
  if (!output.trim()) return null;
  if (!output.startsWith('=> ')) throw new Error(output);
  return JSON.parse(output.slice(3));
}
let step = 0;
function run(code) {
  const id = ++step;
  evaluate(`(()=>{window.__qrsQa=null; void(async()=>{if(app.vault.getName()!==${JSON.stringify(vault)}) throw Error('Wrong vault'); ${code}})().then(value=>window.__qrsQa={step:${id},value:JSON.parse(value)},error=>window.__qrsQa={step:${id},error:String(error)}); return JSON.stringify(true);})()`);
  for(let i=0;i<120;i++) {
    const result=evaluate('JSON.stringify(window.__qrsQa)');
    if(result?.step !== id) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250); continue; }
    if(result?.error) throw new Error(result.error);
    if(result) return result.value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
  }
  throw new Error('QA step timed out');
}
function assert(condition, message) { if (!condition) throw new Error(message); }
const results = [];
function record(name, value) { assert(value, name); results.push({ name, passed: true }); }
const state = 'app.plugins.plugins["qiaomu-ai-rss"].state';
const plugin = 'app.plugins.plugins["qiaomu-ai-rss"]';
const view = 'app.workspace.getLeavesOfType("qiaomu-ai-rss-reader")[0].view';
const delay = 'await new Promise(resolve=>setTimeout(resolve,200))';
const settled = `for(let i=0;i<110&&document.querySelector('.qrs-reader')?.getAttribute('aria-busy')==='true';i++){${delay};}`;
record('Native plugin loaded with 100 real entries', run(`return JSON.stringify(${state}.entries.length===100);`));
record('Open article and render rewrite', run(`document.querySelector('.qrs-entry').click(); ${settled} return JSON.stringify((document.querySelector('.qrs-prose')?.textContent.length||0)>100);`));
record('Favorite persists', run(`const b=document.querySelector('[aria-label="收藏文章"]'); if(b)b.click(); ${delay}; return JSON.stringify(Object.keys(${state}.favorites).length>0);`));
record('Favorite filter', run(`document.querySelector('[data-filter="favorites"]').click(); return JSON.stringify(document.querySelectorAll('.qrs-entry').length>0);`));
record('Original mode', run(`const mode=document.querySelector('[aria-label="阅读版本"]'); mode.value='original'; mode.dispatchEvent(new Event('change')); return JSON.stringify((document.querySelector('.qrs-prose')?.textContent.length||0)>0);`));
record('Missing translation explicit', run(`const mode=document.querySelector('[aria-label="阅读版本"]'); mode.value='translation'; mode.dispatchEvent(new Event('change')); return JSON.stringify(document.querySelector('.qrs-reader').textContent.includes('暂无正文')||!!document.querySelector('.qrs-prose'));`));
record('Save through toolbar', run(`const mode=document.querySelector('[aria-label="阅读版本"]'); mode.value='rewrite'; mode.dispatchEvent(new Event('change')); document.querySelector('[aria-label="保存为笔记"]').click(); for(let i=0;i<40&&!app.vault.getMarkdownFiles().some(f=>f.path.startsWith('Qiaomu RSS/'));i++){${delay};} return JSON.stringify(app.vault.getMarkdownFiles().some(f=>f.path.startsWith('Qiaomu RSS/')));`));
record('Duplicate/concurrent export preserves user edits', run(`const p=${plugin}; const b=Object.values(p.state.favorites)[0]; const f=await p.saveArticle(b,'rewrite',document); const content=await app.vault.read(f); const edited=content+'\\nQA user edit must survive\\n'; await app.vault.modify(f,edited); const files=await Promise.all([p.saveArticle(b,'rewrite',document),p.saveArticle(b,'rewrite',document)]); return JSON.stringify(files[0].path===files[1].path&&(await app.vault.read(f))===edited);`));
record('Offline cached article', run(`await ${plugin}.openReader(); const p=${plugin}; const original=p.api; try {p.api=()=>({article:async()=>{throw Error('QA simulated offline');}}); await ${view}.openArticle(Object.values(p.state.favorites)[0].entry); return JSON.stringify(document.querySelector('.qrs-feedback')?.textContent.includes('缓存')&&(document.querySelector('.qrs-prose')?.textContent.length||0)>100);}finally{p.api=original;}`));
record('Channel cursor pagination', run(`document.querySelector('[data-filter="all"]').click(); ${view}.selectSource('simonwillison'); for(let i=0;i<110&&!document.querySelector('.qrs-more');i++){${delay};} const before=document.querySelectorAll('.qrs-entry').length; const button=document.querySelector('.qrs-more'); if(!button)return JSON.stringify(false); button.click(); for(let i=0;i<110&&document.querySelectorAll('.qrs-entry').length<=before;i++){${delay};} return JSON.stringify(document.querySelectorAll('.qrs-entry').length>before);`));
record('Latest article selection wins a response race', run(`const p=${plugin}; const original=p.api; const v=${view}; const current=Object.values(p.state.cache)[0]; const first=structuredClone(current),second=structuredClone(current); first.entry.id='qa-race-first';second.entry.id='qa-race-second'; try {p.api=()=>({article:async(id)=>{await new Promise(r=>setTimeout(r,id==='qa-race-first'?300:10));return {bundle:id==='qa-race-first'?first:second,warnings:[]};}}); const older=v.openArticle(first.entry); await v.openArticle(second.entry); await older; return JSON.stringify(v.bundle.entry.id==='qa-race-second');}finally{p.api=original; delete p.state.cache['qa-race-first'];delete p.state.cache['qa-race-second'];p.state.readIds=p.state.readIds.filter(id=>!id.startsWith('qa-race-'));}`));
record('List width keyboard resizing', run(`const handle=document.querySelector('[role="separator"]');const before=${state}.settings.listWidth;handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return JSON.stringify(${state}.settings.listWidth===Math.min(520,before+20));`));
const persisted = run(`await ${plugin}.persist(); return JSON.stringify(Object.keys(${state}.favorites));`);
execFileSync('obsidian', [`vault=${vault}`, 'plugin:reload', 'id=qiaomu-ai-rss'], { timeout: 30000 });
record('Plugin reload retains favorites', run(`for(let i=0;i<30&&!${JSON.stringify(persisted)}.every(id=>!!${state}.favorites[id]);i++){${delay};} return JSON.stringify(${JSON.stringify(persisted)}.every(id=>!!${state}.favorites[id]));`));
execFileSync('obsidian', [`vault=${vault}`, 'command', 'id=qiaomu-ai-rss:open-reader']);
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/obsidian-smoke.json', JSON.stringify({ checkedAt: new Date().toISOString(), vault, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
