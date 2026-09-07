const {execFileSync}=require('node:child_process');
const ev=code=>{const output=execFileSync('obsidian',['vault=Qiaomu RSS QA','eval','code='+code.replace(/\n/g,' ')],{encoding:'utf8'}).trim();return output.startsWith('=> ')?JSON.parse(output.slice(3)):null;};
ev(`(()=>{window.__searchQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'],results=[];
const check=(name,ok)=>{if(!ok)throw Error(name);results.push(name)};
await p.openReader();const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
const old=v.query;
const test=(input,name)=>{const button=input.parentElement.querySelector('.qrs-search-clear');check(name+' clear available',!!button);input.value='zz-no-result';input.dispatchEvent(new Event('input',{bubbles:true}));check(name+' visible',getComputedStyle(button).display!=='none');button.click();check(name+' clears and keeps focus',input.value===''&&input.ownerDocument.activeElement===input);check(name+' hidden when empty',getComputedStyle(button).display==='none');check(name+' no tooltip',!button.hasAttribute('title')&&!button.hasAttribute('aria-label'));};
v.toggleSearch(true);test(v.searchInput,'Article');v.searchInput.value=old;v.searchInput.dispatchEvent(new Event('input',{bubbles:true}));v.toggleSearch(!!old);
v.channelButton.click();test(document.querySelector('.qrs-channel-picker input'),'Channel');document.querySelector('.qrs-channel-picker input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
p.manageSubscriptions('explore');test(document.querySelector('.qrs-discovery-search'),'Discovery');p.subscriptionManager.close();
p.openSettings();app.setting.activeTab.containerEl.querySelectorAll('[role=tab]')[3].click();const el=app.setting.activeTab.containerEl;check('Version and release notes shown',el.textContent.includes('当前版本')&&el.textContent.includes('查看本次更新'));const update=[...el.querySelectorAll('button')].find(b=>b.textContent==='管理插件更新');update.click();check('Native update settings opened',app.setting.activeTab.id==='community-plugins');app.setting.close();
window.__searchQA={results};})().catch(e=>window.__searchQA={error:String(e)});return true})()`);
let result;for(let i=0;i<30;i++){result=ev('JSON.stringify(window.__searchQA)');if(result)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);}
console.log(result);if(!result||result.error)process.exitCode=1;
