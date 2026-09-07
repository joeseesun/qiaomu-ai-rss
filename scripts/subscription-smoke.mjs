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
const urls = ['https://reorx.com/feed.xml', 'https://simonwillison.net/atom/everything/'];
run(`for(const feed of [...${state}.subscriptions])if(${JSON.stringify(urls)}.includes(feed.url))await ${plugin}.subscriptions.remove(feed.id); for(const b of document.querySelectorAll('.modal-header-button:has(.lucide-x)'))b.click();return JSON.stringify(true);`);
record('Add real RSS using the subscription form', run(`${plugin}.manageSubscriptions(); const form=document.querySelector('.qrs-subscription-add');form.querySelector('[type=url]').value=${JSON.stringify(urls[0])};form.querySelector('[type=text]').value='中文';form.requestSubmit(); for(let i=0;i<110&&form.querySelector('button').disabled;i++){${delay};}return JSON.stringify(${state}.subscriptions.some(f=>f.url===${JSON.stringify(urls[0])}&&f.entries.length>0));`));
record('Duplicate source rejected through UI', run(`const form=document.querySelector('.qrs-subscription-add');form.querySelector('[type=url]').value=${JSON.stringify(urls[0])};form.requestSubmit();for(let i=0;i<110&&form.querySelector('button').disabled;i++){${delay};}const message=form.closest('.qrs-subscription-modal').querySelector('.qrs-subscription-message');return JSON.stringify(message.textContent.includes('已经添加')&&${state}.subscriptions.filter(f=>f.url===${JSON.stringify(urls[0])}).length===1);`));
record('Add real Atom with a separate group', run(`const form=document.querySelector('.qrs-subscription-add');form.querySelector('[type=url]').value=${JSON.stringify(urls[1])};form.querySelector('[type=text]').value='技术';form.requestSubmit();for(let i=0;i<110&&form.querySelector('button').disabled;i++){${delay};}return JSON.stringify(${state}.subscriptions.some(f=>f.url===${JSON.stringify(urls[1])}&&f.entries.length>0));`));
record('Edit name and group through UI', run(`document.querySelector('.qrs-subscription-row [data-qrs-label^="编辑"]').click(); const modal=[...document.querySelectorAll('.modal')].at(-1);const inputs=modal.querySelectorAll('input');inputs[0].value='个人订阅验收';inputs[0].dispatchEvent(new Event('input',{bubbles:true}));inputs[1].value='研究';inputs[1].dispatchEvent(new Event('input',{bubbles:true}));modal.querySelector('button.mod-cta').click();${delay};return JSON.stringify(${state}.subscriptions.some(f=>f.name==='个人订阅验收'&&f.group==='研究'));`));
record('Export OPML through UI to the vault', run(`const before=app.vault.getFiles().filter(f=>f.extension==='opml').length;[...document.querySelectorAll('.qrs-subscription-tools button')].find(b=>b.textContent==='导出 OPML').click();for(let i=0;i<30&&app.vault.getFiles().filter(f=>f.extension==='opml').length===before;i++){${delay};}const f=app.vault.getFiles().filter(f=>f.extension==='opml').at(-1);return JSON.stringify(!!f&&(await app.vault.read(f)).includes('xmlUrl='));`));
record('OPML preview skips duplicate and unsafe URLs before importing', run(`[...document.querySelectorAll('.qrs-subscription-tools button')].find(b=>b.textContent==='导入 OPML').click();const area=document.querySelector('.qrs-opml-text');area.value='<opml><body><outline text="批量"><outline text="Demo" xmlUrl="https://example.com/qa-feed"/><outline xmlUrl=${JSON.stringify(urls[0])}/><outline xmlUrl="javascript:bad"/></outline></body></opml>';area.dispatchEvent(new Event('input'));const preview=document.querySelector('.qrs-opml-preview').textContent;const modal=[...document.querySelectorAll('.modal')].at(-1);modal.querySelector('button.mod-cta').click();${delay};return JSON.stringify(preview.includes('新增 1')&&preview.includes('跳过 2')&&${state}.subscriptions.some(f=>f.url==='https://example.com/qa-feed'&&f.updatedAt===0));`));
record('Group selection isolates matching local feeds', run(`for(const b of document.querySelectorAll('.modal-header-button:has(.lucide-x)'))b.click();${view}.selectSource('@group:研究',false);return JSON.stringify(${view}.visibleEntries().length>0&&${view}.visibleEntries().every(e=>${state}.subscriptions.find(f=>f.id===e.sourceId)?.group==='研究'));`));
record('Personal articles open in original mode without Qiaomu API calls', run(`const p=${plugin};const api=p.api;p.api=()=>{throw Error('Personal data must not request Qiaomu');};try{document.querySelector('.qrs-entry').click();${delay};return JSON.stringify(document.querySelector('[data-qrs-field="阅读版本"]').value==='original'&&document.querySelector('[data-qrs-field="阅读版本"]').options.length===1&&(document.querySelector('.qrs-prose')?.textContent.length||0)>20);}finally{p.api=api;}`));
record('Favorite and daily-note link work for personal articles', run(`const button=document.querySelector('[data-qrs-label="收藏文章"]');if(button)button.click();${delay};const b=${view}.bundle,result=await ${plugin}.appendToDailyNote(b.entry),content=await app.vault.read(result.file);return JSON.stringify(!!${state}.favorites[b.entry.id]&&content.includes(b.entry.title)&&content.includes('obsidian://qiaomu-ai-rss?')&&!content.includes(b.entry.content));`));
record('Offline refresh retains personal articles', run(`const service=${plugin}.subscriptions;const original=service.transport;const feed=${state}.subscriptions.find(f=>f.group==='研究');const count=feed.entries.length;service.transport=async()=>{throw Error('offline');};try{await service.refresh([feed.id],document,true);return JSON.stringify(feed.entries.length===count&&!!feed.error);}finally{service.transport=original;}`));
record('Unsubscribe through UI keeps favorites', run(`${plugin}.manageSubscriptions();const row=[...document.querySelectorAll('.qrs-subscription-row')].find(r=>r.textContent.includes('个人订阅验收'));const favorite=Object.values(${state}.favorites).find(b=>b.entry.origin==='local');row.querySelector('[data-qrs-label^="取消订阅"]').click();const modal=[...document.querySelectorAll('.modal')].at(-1);[...modal.querySelectorAll('button')].find(b=>b.textContent==='取消订阅').click();${delay};return JSON.stringify(!${state}.subscriptions.some(f=>f.name==='个人订阅验收')&&!!${state}.favorites[favorite.entry.id]);`));
record('Deleted-source favorite remains readable', run(`for(const b of document.querySelectorAll('.modal-header-button:has(.lucide-x)'))b.click();${view}.showSubscriptions();document.querySelector('[data-filter="favorites"]').click();document.querySelector('.qrs-entry').click();${delay};return JSON.stringify((document.querySelector('.qrs-prose')?.textContent.length||0)>20&&${view}.bundle.entry.origin==='local');`));
record('Changing scope invalidates late curated responses', run(`const p=${plugin},v=${view},original=p.api;let finish;try{p.api=()=>({entries:()=>new Promise(r=>finish=r),sources:async()=>({sources:p.state.sources})});v.selectSource('');v.showSubscriptions();finish({entries:[{id:'qa-late',sourceId:'qa',title:'Late'}]});${delay};return JSON.stringify(v.entries.every(e=>e.origin==='local'));}finally{p.api=original;}`));
const before = run(`for(const f of [...${state}.subscriptions])if(f.url==='https://example.com/qa-feed')await ${plugin}.subscriptions.remove(f.id);await ${plugin}.persist();return JSON.stringify(${state}.subscriptions.map(f=>({id:f.id,name:f.name,group:f.group,count:f.entries.length})));`);
execFileSync('obsidian', [`vault=${vault}`, 'plugin:reload', 'id=qiaomu-ai-rss'], { timeout: 30000 });
record('Reload preserves subscriptions, names, groups and cached entries', run(`for(let i=0;i<30&&!${plugin}?.subscriptions;i++){${delay};}return JSON.stringify(JSON.stringify(${state}.subscriptions.map(f=>({id:f.id,name:f.name,group:f.group,count:f.entries.length})))===${JSON.stringify(JSON.stringify(before))});`));
execFileSync('obsidian', [`vault=${vault}`, 'command', 'id=qiaomu-ai-rss:open-reader']);
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/subscription-smoke.json', JSON.stringify({ checkedAt: new Date().toISOString(), vault, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
