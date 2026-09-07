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
evaluate(`(()=>{window.__qrsNavigationQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'],v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
const api=p.api, persist=p.persist,entries=v.entries,filter=v.filter,source=v.source,query=v.query;
const pending=new Map(),results=[];
const check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);};
const fixture=id=>({id,sourceId:'qa',title:id,content:'<p>'+id+'</p>'});
const list=['qa-nav-a','qa-nav-b','qa-nav-c'].map(fixture);
const response=entry=>({bundle:{entry,rewrite:null,translation:null,fetchedAt:Date.now()},warnings:[]});
const key=k=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
try{
 p.persist=()=>Promise.resolve();p.api=()=>({article:id=>new Promise(resolve=>pending.set(id,resolve))});
 v.source='';v.filter='all';v.query='';v.entries=list;
 const first=v.openArticle(list[0]);
 check('Selection is immediate while request is pending',v.bundle.entry.id===list[0].id&&v.articleLoading);
 const font=document.querySelector('[data-qrs-label="阅读设置"]');
 check('Font control belongs to right actions',!!font.closest('.qrs-actions'));
 font.focus();font.click();
 check('Toolbar redraw preserves reader keyboard focus',document.activeElement===v.reader);
 key('j');key('J');
 check('Repeated keys select third article before responses',v.bundle.entry.id===list[2].id);
 pending.get(list[2].id)(response(list[2]));await new Promise(r=>setTimeout(r,30));
 pending.get(list[0].id)(response(list[0]));pending.get(list[1].id)(response(list[1]));await first;
 await new Promise(r=>setTimeout(r,30));
 check('Late responses never replace latest selection',v.bundle.entry.id===list[2].id&&!v.articleLoading);
 key('K');check('Previous key remains usable after loading',v.bundle.entry.id===list[1].id);
 const daily=document.createElement('textarea');document.body.append(daily);daily.focus();
 pending.get(list[1].id)(response(list[1]));await new Promise(r=>setTimeout(r,30));
 check('Background completion does not steal editor focus',document.activeElement===daily);daily.remove();
 p.persist=()=>new Promise(()=>{});
 const saving=v.openArticle(list[0]);pending.get(list[0].id)(response(list[0]));
 await Promise.race([saving,new Promise((_,reject)=>setTimeout(()=>reject(Error('Rendering waits for persistence')),500))]);
 check('Article renders without waiting for slow persistence',!v.articleLoading);
 v.filter='unread';v.unreadSession.clear();p.state.readIds=p.state.readIds.filter(id=>!id.startsWith('qa-nav-'));
 v.openArticle(list[0]);key('j');key('k');
 check('Unread session supports previous after marking articles read',v.bundle.entry.id===list[0].id);
 window.__qrsNavigationQA={results};
}finally{
 v.articleVersion++;v.unreadSession.clear();p.api=api;p.persist=persist;v.entries=entries;v.filter=filter;v.source=source;v.query=query;
 for(const e of list){delete p.state.cache[e.id];}p.state.readIds=p.state.readIds.filter(id=>!id.startsWith('qa-nav-'));
 v.appearanceOpen=false;if(entries[0])void v.openArticle(entries[0]);
}
})().catch(error=>window.__qrsNavigationQA={error:String(error)});return JSON.stringify(true);})()`);
let result;
for(let i=0;i<120;i++) {
  result=evaluate('JSON.stringify(window.__qrsNavigationQA)');
  if(result)break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);
}
if(!result||result.error)throw Error(result?.error||'Navigation test timed out');
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/navigation-smoke.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
