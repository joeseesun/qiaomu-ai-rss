const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createProcessLink } = require('./web-collection/process-link.cjs');

test('English webpage pipeline completes fetch, title/body translation and rewrite in order', async () => {
  const calls = [], entry = { id: 'entry', title: 'Article', content: '<p>Original text</p>' };
  const run = createProcessLink({ fetcher: { async submitLink() { calls.push('fetch'); return entry; } },
    async prepareEntryForAiAsset(e) { calls.push('prepare'); return { entry: e }; },
    async collectionTitle() { calls.push('title'); return { title: '中文标题', originalTitle: 'Article' }; },
    deepseek: { isLikelyEnglish: () => true, async translateEntry(e) { assert.equal(e, entry); calls.push('body'); return { translation: { content: [{ zh: '原文' }] } }; },
      async rewriteEntry(e) { assert.equal(e, entry); calls.push('rewrite'); return { rewrite: { body: '中文改写' } }; } } });
  const stages = [];
  assert.equal((await run('https://example.com/article', s => stages.push(s))).entryId, 'entry');
  assert.deepEqual(calls, ['fetch', 'prepare', 'title', 'body', 'rewrite']);
  assert.deepEqual(stages, ['fetch', 'translation', 'rewrite']);
});
test('failed translation prevents false completion; Chinese existing article skips redundant fetching/translation', async () => {
  let rewrite = 0, translated = 0;
  const dependencies = { fetcher: { getSubmittedEntryByUrl: () => ({ id: 'known', title: '中文', content: '正文' }), submitLink: () => { throw Error('already collected'); } },
    prepareEntryForAiAsset: async entry => ({ entry }), collectionTitle: async () => ({ title: '中文' }),
    deepseek: { isLikelyEnglish: () => true, translateEntry: async () => { translated++; return {}; }, rewriteEntry: async () => { rewrite++; return { rewrite: { body: '正文' } }; } } };
  await assert.rejects(createProcessLink(dependencies)('https://example.com/article'), /Translation not ready/);
  assert.equal(rewrite, 0);
  dependencies.deepseek.isLikelyEnglish = () => false;
  assert.equal((await createProcessLink(dependencies)('https://example.com/article')).entryId, 'known');
  assert.equal(translated, 1); assert.equal(rewrite, 1);
});

function browser(role) {
  const dom = new JSDOM(`<div id="reader-pane"><div id="reader-content"><a href="https://example.com/first">First</a><a href="https://example.com/second"><span>Second</span></a><a href="#section">Section</a><a href="https://rss.qiaomu.ai/#section">Sanitized section</a></div></div><div id="article-link-menu" class="hidden"><button>打开网页</button><button>收录到本站</button></div><div id="admin-page"><div id="admin-manage-status"></div></div>`, { url: 'https://rss.qiaomu.ai/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.requests = [];
  w.eval(`var state = { me: {role: '${role}'}, articleLinkMenuUrl: '' };
    function isAdmin() { return state.me?.role === 'admin'; }
    function articleContentLinkFromTarget(target) { const a = target.closest('a'); return a && articleContentLinkUrl(a) ? a : null; }
    function articleContentLinkUrl(a) { return a.getAttribute('href').startsWith('#') ? '' : a.href; }
    function suppressAnnotationPopoverForLink() {}
    function showArticleLinkMenu(a) { state.articleLinkMenuUrl = a.href; document.querySelector('#article-link-menu').classList.remove('hidden'); return true; }
    function hideArticleLinkMenu() { state.articleLinkMenuUrl = ''; document.querySelector('#article-link-menu').classList.add('hidden'); }
    function toast(message) { window.lastToast = message; }
    async function openEntryById(id, options) { window.opened = {id, options}; }
    async function api(url, options) { window.requests.push({url, options}); const job = {id:'job', url:'https://example.com/second', title:'<img src=x onerror=alert(1)>', status:'complete', stage:'complete', entryId:'entry', createdAt:Date.now()}; return url === '/api/admin/collection-jobs' && options ? {job} : {jobs:[job], nextCursor:''}; }
  `);
  w.eval(fs.readFileSync(path.join(__dirname, 'web-collection/web-collection.js'), 'utf8'));
  return dom;
}
const flush = () => new Promise(r => setTimeout(r, 20));
test('real nested right-click target queues the clicked link; queue dialog is safe and opens completed result', async () => {
  const dom = browser('admin'), w = dom.window;
  try {
    const event = new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 100 });
    w.document.querySelector('#reader-content span').dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(w.document.activeElement.id, 'article-link-enqueue');
    w.document.querySelector('#article-link-enqueue').click(); await flush();
    const body = JSON.parse(w.requests.find(r => r.options?.method === 'POST').options.body);
    assert.equal(body.url, 'https://example.com/second'); assert.equal(body.title, 'Second');
    assert.ok(!w.document.querySelector('#web-collection-modal').classList.contains('hidden'));
    assert.equal(w.document.querySelector('#web-collection-list img'), null);
    w.document.querySelector('[data-job-action="open"]').click(); await flush();
    assert.equal(w.opened.id, 'entry'); assert.equal(w.opened.options.tab, 'rewrite');
    assert.ok(w.document.querySelector('#web-collection-modal').classList.contains('hidden'));
  } finally { w.close(); }
});
test('ordinary users retain native right-click; in-page anchors never enqueue', () => {
  for (const role of ['user', 'admin']) {
    const dom = browser(role), w = dom.window;
    try {
      const event = new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      w.document.querySelector(role === 'admin' ? 'a[href="#section"]' : '#reader-content span').dispatchEvent(event);
      assert.equal(event.defaultPrevented, false); assert.equal(w.requests.length, 0);
      if (role === 'user') assert.ok(w.document.querySelector('#article-link-enqueue').classList.contains('hidden'));
      const absolute = new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      w.document.querySelector('a[href="https://rss.qiaomu.ai/#section"]').dispatchEvent(absolute);
      assert.equal(absolute.defaultPrevented, false);
    } finally { w.close(); }
  }
});
