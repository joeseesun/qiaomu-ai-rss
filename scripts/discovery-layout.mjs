import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
const vault=process.env.RSS_TEST_VAULT || 'Qiaomu RSS QA';
const command=(...args)=>execFileSync('obsidian',[`vault=${vault}`,...args],{encoding:'utf8',timeout:30000});
const evaluate=code=>JSON.parse(command('eval',`code=JSON.stringify((()=>{if(app.vault.getName()!==${JSON.stringify(vault)})throw Error('Wrong vault');${code}})())`).replace(/^=> /,''));
const cdp=(method,params)=>command('dev:cdp',`method=${method}`,`params=${JSON.stringify(params)}`);
const pause=()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,400);
const screenshot=name=>{pause();command('dev:screenshot',`path=${process.cwd()}/docs/images/${name}.png`);pause();};
const close="for(const b of document.querySelectorAll('.modal-header-button:has(.lucide-x)'))b.click();";
const results=[];
const original=evaluate('return document.body.className;');
function check(name,code){const value=evaluate(code);if(!value.ok)throw Error(name+': '+JSON.stringify(value));results.push({name,...value});}
try{
 cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
 evaluate(close+"document.body.removeClass('theme-dark');document.body.addClass('theme-light');return true;");
 command('command','id=qiaomu-ai-rss:explore-subscriptions');pause();
 evaluate("const q=document.querySelector('.qrs-discovery-search');q.value='';q.dispatchEvent(new Event('input'));document.querySelectorAll('.qrs-discovery-collections button')[0].click();const toggle=document.querySelector('.qrs-discovery-toggle input');toggle.checked=false;toggle.dispatchEvent(new Event('change'));document.querySelector('.qrs-discovery-instance').open=false;document.querySelector('.qrs-discovery').scrollTop=0;return true;");
 check('Desktop catalog has no horizontal overflow',"const e=document.querySelector('.qrs-discovery');return{ok:e.scrollWidth<=e.clientWidth,width:e.clientWidth,scrollWidth:e.scrollWidth};");
 screenshot('discovery-featured');
 evaluate("document.querySelectorAll('.qrs-discovery-collections button')[1].click();const tags=document.querySelector('.qrs-discovery-tags');tags.value='';tags.dispatchEvent(new Event('change'));return true;");
 screenshot('discovery-blogs');
 command('command','id=qiaomu-ai-rss:manage-subscriptions');pause();
 const focusCheck="const inputs=[...document.querySelectorAll('.qrs-subscription-add input')];const results=inputs.map(e=>{e.focus();const s=getComputedStyle(e),r=e.getBoundingClientRect(),p=e.closest('.modal-content').getBoundingClientRect();return{inset:s.boxShadow.includes('inset'),outline:s.outlineStyle,inside:r.left>=p.left&&r.right<=p.right&&r.top>=p.top};});inputs[0].focus();return{ok:results.every(r=>r.inset&&r.outline==='none'&&r.inside),results};";
 check('Desktop URL and group input focus stays inside bounds',focusCheck);screenshot('subscriptions-manager');
 cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 evaluate("document.body.removeClass('theme-light');document.body.addClass('theme-dark');return true;");pause();
 check('Narrow dark URL and group focus stays inside bounds',focusCheck);screenshot('subscriptions-narrow');
 evaluate(close+'return true;');pause();
 check('390px blog catalog fits and search retains full focus ring',"const e=document.querySelector('.qrs-discovery'),q=e.querySelector('input[type=search]');q.focus();return{ok:e.scrollWidth<=e.clientWidth&&getComputedStyle(q).boxShadow.includes('inset'),width:e.clientWidth,scrollWidth:e.scrollWidth,cards:e.querySelectorAll('.qrs-discovery-card').length};");
 screenshot('discovery-narrow');
}finally{
 cdp('Emulation.clearDeviceMetricsOverride',{});
 evaluate(`document.body.className=${JSON.stringify(original)};return true;`);
 cdp('Emulation.setFocusEmulationEnabled',{enabled:false});
}
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/discovery-layout.json',JSON.stringify({checkedAt:new Date().toISOString(),vault,results},null,2));console.log(JSON.stringify(results,null,2));
