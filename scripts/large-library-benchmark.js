if (app.vault.getName() !== 'qrs-scale-qa') throw Error('QA only');
const p = app.plugins.plugins['qiaomu-ai-rss']; await p.openReader();
const v = app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
const original = { state: p.state, persist: p.persist, api: p.api };
p.state = structuredClone(p.state); p.state.settings.remoteImages = false; p.state.settings.pickedSourceIds = null; p.persist = async () => {};
v.listVersion++; v.articleVersion++; v.source = '@local'; v.filter = 'all'; v.query = ''; v.platform = 'all';
const results = [];
try {
  for (const count of [100, 500, 2000]) {
    p.state.subscriptions = Array.from({ length: count }, (_, f) => ({id: `local:${f}`, name: `订阅 ${f}`, url: `https://example.com/${f}`, group: '', entries: Array.from({length:50}, (_, e) => ({id:`entry-${f}-${e}`,sourceId:`local:${f}`,origin:'local', title:`第 ${f} 个订阅的文章 ${e}`,summary:'大订阅量测试：保留阅读位置、标题摘要和离线内容。',publishedTs:1792065600000-e*1000-f}))}));
    v.resetWindow(); v.personalLimit=100; v.list.scrollTop=0; let start=performance.now(); v.entries=v.localEntries(); v.renderList();
    const firstMs=performance.now()-start, firstRows=v.list.querySelectorAll('.qrs-entry').length;
    start=performance.now(); for(let i=0;i<5;i++)v.renderList(); const repeatedMs=(performance.now()-start)/5;
    start=performance.now(); v.query='第 99 个订阅的文章 49'; v.renderList(); const searchMs=performance.now()-start; v.query='';v.renderList();
    if(v.virtual){v.list.scrollTop=v.virtual.total-700;v.renderList(true);}else {v.personalLimit=2000;v.renderList();v.list.scrollTop=v.list.scrollHeight;}
    results.push({feeds:count,articles:count*50,firstMs,repeatedMs,searchMs,firstRows,deepRows:v.list.querySelectorAll('.qrs-entry').length});
  }
  return {version:p.manifest.version,results};
} finally {v.listVersion++;v.articleVersion++;p.state=original.state;p.persist=original.persist;p.api=original.api;v.reset();}
