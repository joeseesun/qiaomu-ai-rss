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
const closeModals = "for(const b of document.querySelectorAll('.modal-header-button:has(.lucide-x)'))b.click();";
run(closeModals + 'return JSON.stringify(true);');
run(`for(const feed of [...${state}.subscriptions])if(['https://reorx.com/feed.xml','https://rsshub.rssforever.com/36kr/newsflashes','https://rsshub.rssforever.com/github/trending/daily/any'].includes(feed.url))await ${plugin}.subscriptions.remove(feed.id);return JSON.stringify(true);`);
record('Discovery opens locally without feed requests',run(`const p=${plugin},transport=p.subscriptions.transport;let requests=0;p.subscriptions.transport=async()=>{requests++;throw Error('Unexpected request');};try{for(const leaf of app.workspace.getLeavesOfType('qiaomu-ai-rss-discovery'))leaf.detach();await p.openDiscovery();return JSON.stringify(requests===0&&document.querySelectorAll('.qrs-discovery-card').length===12);}finally{p.subscriptions.transport=transport;}`));
record('Blog catalog loads only first 60 of 1342 entries',run(`document.querySelectorAll('.qrs-discovery-collections button')[1].click();return JSON.stringify(document.querySelectorAll('.qrs-discovery-card').length===60&&document.querySelector('.qrs-discovery-count').textContent.includes('1342'));`));
record('Blog pagination adds next 60 cards',run(`document.querySelector('.qrs-discovery-more').click();return JSON.stringify(document.querySelectorAll('.qrs-discovery-card').length===120);`));
record('Blog search and theme combine without network',run(`const q=document.querySelector('.qrs-discovery-search');q.value='Reorx';q.dispatchEvent(new Event('input'));const tag=document.querySelector('.qrs-discovery-tags');tag.value='软件开发';tag.dispatchEvent(new Event('change'));return JSON.stringify(document.querySelectorAll('.qrs-discovery-card').length===1&&document.querySelector('.qrs-discovery-card h2').textContent.includes('Reorx'));`));
const before=run(`return JSON.stringify(${state}.subscriptions.map(f=>f.url));`);
record('Subscribe to an independent blog via its card',run(`const button=document.querySelector('.qrs-discovery-card button');if(!button.disabled)button.click();for(let i=0;i<110&&document.querySelector('.qrs-discovery-card button').textContent==='添加中…';i++){${delay};}return JSON.stringify(document.querySelector('.qrs-discovery-card button').textContent==='已订阅'&&${state}.subscriptions.some(f=>f.url==='https://reorx.com/feed.xml'&&f.entries.length>0));`));
record('Search has clear empty state',run(`const q=document.querySelector('.qrs-discovery-search');q.value='impossible-blog-987654321';q.dispatchEvent(new Event('input'));return JSON.stringify(document.querySelectorAll('.qrs-discovery-card').length===0&&document.querySelector('.qrs-discovery-grid .qrs-empty').textContent.includes('没有找到'));`));
record('RSSHub-only filter shows both verified routes',run(`const q=document.querySelector('.qrs-discovery-search');q.value='';q.dispatchEvent(new Event('input'));document.querySelectorAll('.qrs-discovery-collections button')[0].click();const toggle=document.querySelector('.qrs-discovery-toggle input');toggle.checked=true;toggle.dispatchEvent(new Event('change'));return JSON.stringify(document.querySelectorAll('.qrs-discovery-card').length===2);`));
record('Subscribe to RSSHub 36kr route through its card',run(`const button=document.querySelector('[data-feed="36kr"] button');if(!button.disabled)button.click();for(let i=0;i<110&&document.querySelector('[data-feed="36kr"] button').textContent==='添加中…';i++){${delay};}return JSON.stringify(document.querySelector('[data-feed="36kr"] button').textContent==='已订阅'&&${state}.subscriptions.some(f=>f.url.endsWith('/36kr/newsflashes')&&f.entries.length>0));`));
record('Invalid instance address cannot replace saved instance',run(`const before=${state}.settings.rsshubUrl;const f=document.querySelector('.qrs-discovery-instance-form');f.querySelector('input').value='http://unsafe.example';f.requestSubmit();${delay};return JSON.stringify(${state}.settings.rsshubUrl===before&&document.querySelector('.qrs-discovery-instance .qrs-subscription-message').textContent.includes('HTTPS'));`));
record('Failed card remains retryable without storing a subscription',run(`const p=${plugin},transport=p.subscriptions.transport,count=p.state.subscriptions.length;p.subscriptions.transport=async()=>({status:503,text:''});try{document.querySelector('[data-feed="github"] button').click();${delay};return JSON.stringify(document.querySelector('[data-feed="github"] button').textContent==='重试'&&document.querySelector('[data-feed="github"] .qrs-subscription-error').textContent.includes('503')&&p.state.subscriptions.length===count);}finally{p.subscriptions.transport=transport;}`));
record('Retry fetches real GitHub RSSHub articles and prevents duplicates',run(`document.querySelector('[data-feed="github"] button').click();for(let i=0;i<110&&document.querySelector('[data-feed="github"] button').textContent==='添加中…';i++){${delay};}return JSON.stringify(document.querySelector('[data-feed="github"] button').disabled&&document.querySelector('[data-feed="github"] button').textContent==='已订阅'&&${state}.subscriptions.some(f=>f.url.endsWith('/github/trending/daily/any')&&f.entries.length>0));`));
record('Start reading shows local feeds and article content',run(`[...document.querySelectorAll('.qrs-discovery-actions button')].find(b=>b.textContent==='开始阅读').click();${delay};document.querySelector('.qrs-entry').click();${delay};return JSON.stringify((document.querySelector('.qrs-prose')?.textContent.length||0)>20&&${view}.bundle.entry.origin==='local');`));
record('Subscription input uses an inset focus ring within scroll bounds',run(`${plugin}.manageSubscriptions();const input=document.querySelector('.qrs-subscription-add input');input.focus();const style=getComputedStyle(input),rect=input.getBoundingClientRect(),container=input.closest('.modal-content').getBoundingClientRect();return JSON.stringify(style.outlineStyle==='none'&&style.boxShadow.includes('inset')&&rect.left>=container.left&&rect.top>=container.top);`));
record('Subscription manager opens discovery in the existing tab',run(`[...document.querySelectorAll('.qrs-subscription-tools button')].find(b=>b.textContent==='探索订阅').click();${delay};return JSON.stringify(!document.querySelector('.qrs-subscription-modal')&&app.workspace.getLeavesOfType('qiaomu-ai-rss-discovery').length===1);`));
run(`for(const feed of [...${state}.subscriptions])if(!${JSON.stringify(before)}.includes(feed.url))await ${plugin}.subscriptions.remove(feed.id);${plugin}.refreshDiscovery();return JSON.stringify(true);`);
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/discovery-smoke.json',JSON.stringify({checkedAt:new Date().toISOString(),vault,results},null,2));console.log(JSON.stringify(results,null,2));
