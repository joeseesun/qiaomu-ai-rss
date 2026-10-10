// Run inside a dedicated Obsidian QA vault using qiaomu-obsidian-dev/scripts/host_eval.py.
// Uses the installed plugin and actual DOM clicks; transport failures below are controlled fixtures.
if (app.vault.getName() !== 'qiaomu-home-dashboard-qa') throw Error('QA vault only');
const p = app.plugins.plugins['qiaomu-ai-rss'];
await p.openReader();
const leaf = app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0];
await leaf.loadIfDeferred();
const v = leaf.view, Api = p.api().constructor;
const original = { state: p.state, api: p.api, persist: p.persist, remember: p.remember, syncDeletedArticles: p.syncDeletedArticles };
const checks = [];
const check = (name, passed, details = {}) => { checks.push({ name, passed: !!passed, ...details }); if (!passed) throw Error(name + ': ' + JSON.stringify(details)); };
const waitFor = async (test, ms = 3000) => { const start = Date.now(); while (!test()) { if (Date.now() - start > ms) throw Error('Condition timed out'); await new Promise(r => setTimeout(r, 25)); } };
const reply = value => ({ status: 200, text: JSON.stringify(value) });
const entry = { id: 'qa-recovery', sourceId: 'user-submitted', title: '加载恢复测试', content: '<p>正文已恢复，无需重新打开文章。</p>' };
const preview = { ...entry, content: undefined };
const body = () => v.reader.querySelector('.qrs-prose')?.textContent || '';
const bundle = (rewrite = null) => ({ entry, rewrite, translation: null, fetchedAt: Date.now() });
const capture = async name => {
  const win = require('electron').remote.getCurrentWindow();
  win.show(); win.focus(); win.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 250));
  const image = await win.webContents.capturePage();
  require('fs').writeFileSync('/tmp/' + name + '.png', image.toPNG());
};
p.state = structuredClone(p.state); p.state.settings.defaultMode = 'rewrite'; p.state.settings.remoteImages = false; p.state.settings.pickedSourceIds = null;
p.persist = async () => {}; p.remember = () => {}; p.syncDeletedArticles = async () => {};
v.listVersion++; v.articleVersion++; v.source = 'user-submitted'; v.filter = 'all'; v.platform = 'all'; v.query = '';
try {
  p.state.cache[entry.id] = bundle();
  let release;
  p.api = () => ({ article: () => new Promise(r => { release = r; }) });
  let opening = v.openArticle(preview);
  check('cached original is visible during preferred rewrite refresh', !v.articleLoading && v.mode === 'original' && body().includes('正文已恢复'));
  release({ bundle: bundle({ body: '更新后的改写正文' }), warnings: [] }); await opening;
  check('preferred rewrite appears when ready', v.mode === 'rewrite' && body().includes('更新后的改写正文'));
  opening = v.openArticle(preview);
  const selector = v.reader.querySelector('.qrs-mode-select'); selector.value = 'original'; selector.dispatchEvent(new Event('change'));
  release({ bundle: bundle({ body: '不应覆盖手动原文选择' }), warnings: [] }); await opening;
  check('manual original survives late rewrite', v.mode === 'original' && body().includes('正文已恢复'));
  delete p.state.cache[entry.id];

  let detailCalls = 0;
  let api = new Api('https://rss.qiaomu.ai', async url => {
    if (url.endsWith('/rewrite')) return reply({ rewrite: null });
    if (url.endsWith('/translation')) return reply({ translation: null });
    return ++detailCalls === 1 ? { status: 502, text: '' } : reply({ entry });
  });
  p.api = () => api; v.entries = [preview]; v.renderList();
  let started = Date.now(); v.list.querySelector('.qrs-entry').click();
  await waitFor(() => body().includes('正文已恢复'));
  check('actual article click recovers HTTP 502 once', detailCalls === 2 && !v.articleFailed, { ms: Date.now() - started });

  detailCalls = 0;
  api = new Api('https://rss.qiaomu.ai', async url => {
    if (url.endsWith('/rewrite')) return reply({ rewrite: null });
    if (url.endsWith('/translation')) return reply({ translation: null });
    detailCalls++; return new Promise(resolve => setTimeout(() => resolve(reply({ entry })), 8500));
  }); p.api = () => api; started = Date.now(); await v.openArticle(preview);
  check('slow detail stays one request and appears within 9 seconds', detailCalls === 1 && Date.now() - started < 9000 && body().includes('正文已恢复'), { ms: Date.now() - started });

  api = new Api('https://rss.qiaomu.ai', () => new Promise(() => {})); p.api = () => api;
  started = Date.now(); await v.openArticle(preview, undefined, 'original');
  check('offline stops loading at total deadline and offers inline retry', Date.now() - started < 21000 && !v.articleLoading && v.articleFailed && v.reader.querySelector('.qrs-feedback-retry'), { ms: Date.now() - started });
  await capture('qrs-article-retry');
  api = new Api('https://rss.qiaomu.ai', async url => reply(url.endsWith('/rewrite') ? { rewrite: { body: 'Available rewrite' } } : url.endsWith('/translation') ? { translation: null } : { entry }));
  v.reader.querySelector('.qrs-feedback-retry').click();
  await waitFor(() => !v.articleFailed && !v.articleLoading && body().includes('正文已恢复'));
  check('retry button recovers while retaining selected original', v.mode === 'original' && !v.reader.querySelector('.qrs-feedback-retry'));

  const releases = {};
  p.api = () => ({ article: id => new Promise(r => { releases[id] = r; }) });
  const older = v.openArticle({ ...preview, id: 'qa-older' });
  const newer = v.openArticle({ ...preview, id: 'qa-newer' });
  releases['qa-newer']({ bundle: { ...bundle(), entry: { ...entry, id: 'qa-newer', content: '<p>最新文章</p>' } }, warnings: [] }); await newer;
  releases['qa-older']({ bundle: { ...bundle(), entry: { ...entry, id: 'qa-older', content: '<p>旧文章</p>' } }, warnings: [] }); await older;
  check('switching articles rejects stale response', v.bundle.entry.id === 'qa-newer' && body().includes('最新文章'));

  let catalogCalls = 0, listCalls = 0;
  p.api = () => ({ sources: async () => { if (++catalogCalls === 1) throw Error('QA catalog offline'); return { sources: original.state.sources }; }, entries: async () => { listCalls++; return { entries: [preview], hasMore: false }; } });
  await v.loadEntries(false, true);
  check('catalog failure retains readable list and old channels', !!v.status.querySelector('.qrs-feedback-retry') && v.status.textContent.includes('原有频道') && v.entries.length === 1);
  await capture('qrs-catalog-retry');
  v.status.querySelector('.qrs-feedback-retry').click(); await waitFor(() => !v.status.textContent);
  check('catalog retry does not reload article list', catalogCalls === 2 && listCalls === 1);

  let writes = 0; catalogCalls = 0;
  p.api = () => ({ sources: async () => { catalogCalls++; return { sources: original.state.sources }; }, entries: async () => ({ entries: [preview], hasMore: false }) });
  p.persist = async () => { if (++writes === 1) throw Error('QA local save denied'); };
  await v.loadEntries(false, true);
  check('local save failure is not mislabeled as channel fetch failure', v.status.textContent.includes('本地更新失败') && !v.status.textContent.includes('频道加载失败'));
  v.status.querySelector('.qrs-feedback-retry').click(); await waitFor(() => !v.status.textContent);
  check('local retry does not refetch successful catalog', catalogCalls === 1);
  return { version: p.manifest.version, checks };
} finally {
  v.listVersion++; v.articleVersion++;
  if (v.checkpointTimer) { clearTimeout(v.checkpointTimer); v.checkpointTimer = undefined; }
  Object.assign(p, original);
  v.reset();
}
