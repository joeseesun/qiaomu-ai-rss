const {execFileSync}=require('node:child_process');const fs=require('node:fs');
const vault=process.env.RSS_TEST_VAULT||'qiaomu-public-install.NmoBsq';const cmd=(...a)=>execFileSync('obsidian',[`vault=${vault}`,...a],{encoding:'utf8',timeout:30000});const ev=c=>JSON.parse(cmd('eval','code=JSON.stringify((()=>{'+c+'})())').replace(/^=> /,''));const cdp=(m,p)=>cmd('dev:cdp','method='+m,'params='+JSON.stringify(p));const pause=()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);const results=[];
fs.mkdirSync('artifacts',{recursive:true});
const original=ev('return document.body.className;');
function check(name,code){const value=ev(code);if(!value)throw Error(name);results.push(name);}
try{
 cmd('command','id=qiaomu-ai-rss:explore-subscriptions');pause();ev("[...document.querySelectorAll('.qrs-discovery-section button')].find(b=>b.textContent==='返回推荐')?.click();return true;");
 for(const dark of [false,true])for(const width of [1280,390]){
 cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});ev(`document.body.toggleClass('theme-dark',${dark});document.body.toggleClass('theme-light',${!dark});return true;`);pause();
 check(`${width}px ${dark?'dark':'light'} discovery fits viewport`,"const e=document.querySelector('.qrs-discovery:not(.qrs-library)'),form=e.querySelector('form');return e.scrollWidth<=e.clientWidth+1&&form.scrollWidth<=form.clientWidth+1;");
 cmd('dev:screenshot',`path=${process.cwd()}/artifacts/discovery-${width}-${dark?'dark':'light'}.png`);
 cmd('command','id=qiaomu-ai-rss:manage-subscriptions');pause();
 check(`${width}px library page fits viewport`,"const e=document.querySelector('.qrs-library');return e.scrollWidth<=e.clientWidth+1;");
 cmd('dev:screenshot',`path=${process.cwd()}/artifacts/library-${width}-${dark?'dark':'light'}.png`);
 cmd('command','id=qiaomu-ai-rss:explore-subscriptions');pause();
 ev("[...document.querySelectorAll('.qrs-discovery-actions button')].find(b=>b.textContent==='导入 OPML').click();return true;");pause();
 check(`${width}px OPML controls fit viewport`,"const e=document.querySelector('.qrs-subscription-modal .modal-content');return e.scrollWidth<=e.clientWidth+1;");
 ev("document.querySelector('.qrs-subscription-modal .modal-header-button').click();return true;");
 }
}finally{cdp('Emulation.clearDeviceMetricsOverride',{});ev('document.body.className='+JSON.stringify(original)+';return true;');}
console.log(results);fs.writeFileSync('artifacts/personal-library-layout.json',JSON.stringify({vault,results},null,2));
