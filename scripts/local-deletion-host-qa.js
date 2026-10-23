// Async body for scripts/qa-host.mjs, using a disposable synthetic QA vault only.
if (app.vault.adapter.basePath !== '/tmp/qrs-local-delete-qa') throw Error('Use the synthetic local-delete QA vault');
const p=app.plugins.plugins['qiaomu-ai-rss'];await p.openReader();
await p.restoreLocalArticles([...p.state.localDeletedEntries]);
const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out');};
await wait(()=>!v.loading);
const results=[],check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);};
const entry=p.state.subscriptions[0].entries[5], bundle={entry,rewrite:null,translation:null,fetchedAt:1};
const note='local-deletion-preserved.md';if(!app.vault.getAbstractFileByPath(note))await app.vault.create(note,'Preserve this saved note.');
p.state.favorites[entry.id]=bundle;p.state.savedArticles[entry.id]=bundle;p.state.readLater=[entry.id];p.state.articleNotes[entry.id+'|original']=note;await p.persist();
const before=JSON.stringify({fav:p.state.favorites[entry.id],saved:p.state.savedArticles[entry.id],later:p.state.readLater,notes:p.state.articleNotes,reads:p.state.readIds});
let serverDeletes=0;const originalClient=p.collectionClient;p.collectionClient=()=>{serverDeletes++;throw Error('Server delete forbidden');};
await p.deleteArticleLocally(entry);
check('removed from list',!v.visibleEntries().some(e=>e.id===entry.id));
for(const filter of ['all','unread','favorites','later']){v.filter=filter;check('hidden in '+filter,!v.visibleEntries().some(e=>e.id===entry.id));}
check('saved state preserved',before===JSON.stringify({fav:p.state.favorites[entry.id],saved:p.state.savedArticles[entry.id],later:p.state.readLater,notes:p.state.articleNotes,reads:p.state.readIds}));
check('no server mutation',serverDeletes===0);p.collectionClient=originalClient;
check('note file intact',await app.vault.adapter.read(note)==='Preserve this saved note.');
check('home search excludes hidden',p.qiaomuHome.search('测试文章 5',100).every(e=>e.id!==entry.id));
const undo=[...p.deletionNotice.noticeEl.querySelectorAll('button')].find(b=>b.textContent==='撤销');check('undo is visible',!!undo);undo.click();await wait(()=>!p.localArticleDeleted(entry));
v.filter='all';check('undo restores entry',v.visibleEntries().some(e=>e.id===entry.id));
await v.openArticle(entry);p.state.readLater=[entry.id];await p.persist();
const scroll=v.list.scrollTop;await p.deleteArticleLocally(entry);await wait(()=>v.bundle?.entry.id!==entry.id);
check('deleting current opens next',v.bundle?.entry.id==='local-qa-6');
check('scroll retained',Math.abs(v.list.scrollTop-scroll)<2);
check('deleted queue relationship retained',p.state.readLater.includes(entry.id));
const record=p.state.localDeletedEntries[0];
const saved=JSON.parse(await app.vault.adapter.read('.obsidian/plugins/qiaomu-ai-rss/data.json'));
check('tombstone reaches disk',saved.localDeletedEntries.some(r=>r.entry.id===entry.id));
check('source metadata retained',p.state.subscriptions[0].entries.some(e=>e.id===entry.id));
await p.restoreLocalArticles([record]);check('restore preserves favorite',!!p.state.favorites[entry.id]);
const persist=p.persist;p.persist=async()=>{throw Error('Synthetic disk failure');};
try{await p.deleteArticleLocally(entry);throw Error('Expected save failure');}catch(e){check('failure rolls back deletion',!p.localArticleDeleted(entry)&&e.message==='Synthetic disk failure');}finally{p.persist=persist;}
await p.deleteArticleLocally(entry);const old=p.state.localDeletedEntries;
p.persist=async()=>{throw Error('Synthetic restore failure');};try{await p.restoreLocalArticles([...old]);}catch{check('failure retains deletion',p.localArticleDeleted(entry));}finally{p.persist=persist;}
p.openDeletedArticles();
check('manager opens',p.deletedArticlesModal.modalEl.isConnected);
const restore=p.deletedArticlesModal.modalEl.querySelector('.qrs-deleted-row button');check('manager has restore',restore?.textContent==='恢复');restore.click();await wait(()=>!p.localArticleDeleted(entry));
check('manager updates after restore',p.deletedArticlesModal.modalEl.querySelectorAll('.qrs-deleted-row').length===0);
p.deletedArticlesModal.close();
await p.deleteArticleLocally(entry);
return {vault:app.vault.adapter.basePath,version:p.manifest.version,assertions:results.length,results};
