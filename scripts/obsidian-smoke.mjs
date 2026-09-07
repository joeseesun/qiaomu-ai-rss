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
record('Native plugin loaded with 100 real entries', run(`${view}.selectSource('',false);return JSON.stringify(${state}.entries.length===100);`));
record('Article thumbnails use local Blob URLs', run(`for(let i=0;i<40&&document.querySelectorAll('.qrs-entry-thumb img[src^="blob:"]').length===0;i++){${delay};}return JSON.stringify(${state}.entries.some(e=>e.image)&&document.querySelectorAll('.qrs-entry-thumb img[src^="blob:"]').length>0);`));
record('Channel picker groups sources with icons and clean names', run(`${view}.pickChannel();const modal=document.querySelector('.qrs-channel-modal'),sections=[...modal.querySelectorAll('.qrs-channel-section h3')].map(e=>e.textContent),rows=[...modal.querySelectorAll('.qrs-channel-row')];const ok=sections.includes('聚合')&&sections.includes('乔木频道')&&rows.length>10&&rows.every(row=>!!row.querySelector('.qrs-channel-mark'))&&rows.every(row=>!row.querySelector('.qrs-channel-name').textContent.includes(' / '))&&modal.querySelectorAll('[aria-label],[title]').length===0;rows[0].click();return JSON.stringify(ok);`));
record('Open article and render rewrite', run(`document.querySelector('.qrs-entry').click(); ${settled} return JSON.stringify((document.querySelector('.qrs-prose')?.textContent.length||0)>100);`));
record('Favorite persists', run(`const b=document.querySelector('[data-qrs-label="收藏文章"]'); if(b)b.click(); ${delay}; return JSON.stringify(Object.keys(${state}.favorites).length>0);`));
record('Favorite filter', run(`document.querySelector('[data-filter="favorites"]').click(); return JSON.stringify(document.querySelectorAll('.qrs-entry').length>0);`));
record('Original mode', run(`const mode=document.querySelector('[data-qrs-field="阅读版本"]'); mode.value='original'; mode.dispatchEvent(new Event('change')); return JSON.stringify((document.querySelector('.qrs-prose')?.textContent.length||0)>0);`));
const previousAppearance = run(`const s=${state}.settings;return JSON.stringify({fontSize:s.fontSize,fontFamily:s.fontFamily,lineHeight:s.lineHeight,lineWidth:s.lineWidth});`);
record('Reading settings update font, size, line height and measure live', run(`document.querySelector('[data-qrs-label="阅读设置"]').click();const panel=document.querySelector('.qrs-reading-settings'),font=panel.querySelector('[data-qrs-field="正文字体"]'),size=panel.querySelector('[data-qrs-field="正文字号"]'),height=panel.querySelector('[data-qrs-field="正文行距"]'),width=panel.querySelector('[data-qrs-field="正文宽度"]');font.value='sans';font.dispatchEvent(new Event('change'));size.value='22';size.dispatchEvent(new Event('input'));size.dispatchEvent(new Event('change'));height.value='2.1';height.dispatchEvent(new Event('input'));height.dispatchEvent(new Event('change'));width.value='44';width.dispatchEvent(new Event('change'));${delay};const root=document.querySelector('.qrs-root'),s=${state}.settings;return JSON.stringify(!!panel&&s.fontFamily==='sans'&&s.fontSize===22&&s.lineHeight===2.1&&s.lineWidth===44&&root.dataset.readingFont==='sans'&&root.style.getPropertyValue('--qrs-font-size')==='22px'&&root.style.getPropertyValue('--qrs-line-height')==='2.1'&&root.style.getPropertyValue('--qrs-article-width')==='1088px');`));
record('Reader avoids tooltip-triggering accessibility attributes', run(`const root=document.querySelector('.qrs-root'),note=root.querySelector('[data-qrs-label="记到今日日记"]');return JSON.stringify(root.querySelectorAll('[aria-label],[title]').length===0&&note?.querySelector('.qrs-visually-hidden')?.textContent==='记到今日日记');`));
record('Missing translation explicit', run(`const mode=document.querySelector('[data-qrs-field="阅读版本"]'); mode.value='translation'; mode.dispatchEvent(new Event('change')); return JSON.stringify(document.querySelector('.qrs-reader').textContent.includes('暂无正文')||!!document.querySelector('.qrs-prose'));`));
record('Daily-note action appends title and URL then opens a split', run(`const b=${view}.bundle,link='obsidian://qiaomu-ai-rss?';document.querySelector('[data-qrs-label="记到今日日记"]').click();let file;for(let i=0;i<40&&!file;i++){${delay};for(const f of app.vault.getMarkdownFiles())if((await app.vault.read(f)).includes(link)){file=f;break;}}if(!file)return JSON.stringify(false);const content=await app.vault.read(file),open=app.workspace.getLeavesOfType('markdown').some(l=>l.view.file?.path===file.path);return JSON.stringify(open&&content.includes('['+b.entry.title)&&content.includes(link)&&!content.includes('rss_id:')&&!content.includes(b.entry.content||'__missing__'));`));
record('Repeated daily-note action does not duplicate the article', run(`const p=${plugin},b=${view}.bundle;const first=await p.noteArticle(b.entry),before=await app.vault.read(first.file),second=await p.noteArticle(b.entry),after=await app.vault.read(second.file),count=after.split(encodeURIComponent(b.entry.id)+'&mode=').length-1,leaves=app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file?.path===first.file.path).length;return JSON.stringify(first.file.path===second.file.path&&before===after&&count===1&&leaves===1);`));
record('Offline cached article', run(`await ${plugin}.openReader(); const p=${plugin}; const original=p.api; try {p.api=()=>({article:async()=>{throw Error('QA simulated offline');}}); await ${view}.openArticle(Object.values(p.state.favorites)[0].entry); return JSON.stringify(document.querySelector('.qrs-feedback')?.textContent.includes('缓存')&&(document.querySelector('.qrs-prose')?.textContent.length||0)>100);}finally{p.api=original;}`));
record('Channel cursor pagination', run(`document.querySelector('[data-filter="all"]').click(); ${view}.selectSource('simonwillison'); for(let i=0;i<110&&!document.querySelector('.qrs-more');i++){${delay};} const before=document.querySelectorAll('.qrs-entry').length; const button=document.querySelector('.qrs-more'); if(!button)return JSON.stringify(false); button.click(); for(let i=0;i<110&&document.querySelectorAll('.qrs-entry').length<=before;i++){${delay};} return JSON.stringify(document.querySelectorAll('.qrs-entry').length>before);`));
record('Latest article selection wins a response race', run(`const p=${plugin}; const original=p.api; const v=${view}; const current=Object.values(p.state.cache)[0]; const first=structuredClone(current),second=structuredClone(current); first.entry.id='qa-race-first';second.entry.id='qa-race-second'; try {p.api=()=>({article:async(id)=>{await new Promise(r=>setTimeout(r,id==='qa-race-first'?300:10));return {bundle:id==='qa-race-first'?first:second,warnings:[]};}}); const older=v.openArticle(first.entry); await v.openArticle(second.entry); await older; return JSON.stringify(v.bundle.entry.id==='qa-race-second');}finally{p.api=original; delete p.state.cache['qa-race-first'];delete p.state.cache['qa-race-second'];p.state.readIds=p.state.readIds.filter(id=>!id.startsWith('qa-race-'));}`));
record('List width keyboard resizing', run(`const handle=document.querySelector('[role="separator"]');const before=${state}.settings.listWidth;handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return JSON.stringify(${state}.settings.listWidth===Math.min(520,before+20));`));
const persisted = run(`await ${plugin}.persist(); return JSON.stringify(Object.keys(${state}.favorites));`);
execFileSync('obsidian', [`vault=${vault}`, 'plugin:reload', 'id=qiaomu-ai-rss'], { timeout: 30000 });
record('Plugin reload retains favorites', run(`for(let i=0;i<30&&!${JSON.stringify(persisted)}.every(id=>!!${state}.favorites[id]);i++){${delay};} return JSON.stringify(${JSON.stringify(persisted)}.every(id=>!!${state}.favorites[id]));`));
record('Plugin reload retains reading appearance', run(`${plugin}.resetViews();const s=${state}.settings,root=document.querySelector('.qrs-root');return JSON.stringify(s.fontFamily==='sans'&&s.fontSize===22&&s.lineHeight===2.1&&s.lineWidth===44&&root.dataset.readingFont==='sans'&&root.style.getPropertyValue('--qrs-font-size')==='22px');`));
run(`Object.assign(${state}.settings,${JSON.stringify(previousAppearance)});await ${plugin}.persist();${plugin}.resetViews();return JSON.stringify(true);`);
execFileSync('obsidian', [`vault=${vault}`, 'command', 'id=qiaomu-ai-rss:open-reader']);
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/obsidian-smoke.json', JSON.stringify({ checkedAt: new Date().toISOString(), vault, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
