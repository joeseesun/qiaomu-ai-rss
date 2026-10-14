const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { mountLabCollection } = require('./lab-collection');

function fixture(directory, processLink, extra = {}) {
  const routes = {};
  const app = { get(p, ...h) { routes['GET ' + p] = h; }, post(p, ...h) { routes['POST ' + p] = h; } };
  const control = mountLabCollection(app, { directory, processLink, codes: () => '',
    validateUrl(value) { const u = new URL(value); if (u.hostname !== 'example.com' || u.protocol !== 'https:') throw Error('invalid'); u.hash = ''; return u.href; },
    adminAuth: { isEntryDeleted: id => id === 'deleted' }, ...extra });
  function call(method, suffix = '', body = {}, user = { id: 'admin', role: 'admin', displayName: 'Admin' }, origin = 'https://rss.qiaomu.ai') {
    const req = { method, body, user, params: { id: suffix.split('/')[1] }, query: {}, get(name) { return ({ origin, host: 'rss.qiaomu.ai' })[name.toLowerCase()]; } };
    const res = { code: 200, setHeader() {}, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } };
    const key = method + ' /api/admin/collection-jobs' + (suffix.includes('/retry') ? '/:id/retry' : suffix ? '/:id' : '');
    assert.ok(routes[key], 'missing administrator queue endpoint ' + key);
    const run = n => routes[key][n]?.(req, res, () => run(n + 1)); run(0); return res;
  }
  return { call, control };
}
const tick = () => new Promise(r => setTimeout(r, 20));
test('website administrator queue authenticates before work and deduplicates URLs durably', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-web-queue-'));
  let count = 0, release;
  const blocked = new Promise(r => release = r);
  const f = fixture(dir, async (url, progress) => { count++; progress('translation'); await blocked; progress('rewrite'); return { entryId: 'entry', title: '中文标题', originalTitle: 'English title' }; });
  try {
    assert.equal(f.call('POST', '', { url: 'https://example.com/article' }, null).code, 403);
    assert.equal(f.call('POST', '', { url: 'https://example.com/article' }, { id: 'u', role: 'user' }).code, 403);
    assert.equal(f.call('POST', '', { url: 'https://example.com/article' }, undefined, 'https://evil.example').code, 403);
    assert.equal(f.call('POST', '', { url: 'http://localhost/internal' }).code, 400);
    assert.equal(count, 0);
    const queued = f.call('POST', '', { url: 'https://example.com/article#x', title: 'Clicked link' });
    assert.equal(queued.code, 202);
    const id = queued.data.job.id;
    assert.equal(f.call('GET', '/' + id).data.job.stage, 'translation');
    const duplicate = f.call('POST', '', { url: 'https://example.com/article' });
    assert.equal(duplicate.code, 200); assert.equal(duplicate.data.job.id, id);
    assert.equal(count, 1); release(); await tick();
    assert.equal(f.call('GET', '/' + id).data.job.status, 'complete');
    assert.equal(f.call('GET').data.jobs[0].submitter, 'Admin');
    f.control.stop();
    const restored = fixture(dir, async () => { count++; throw Error('should use completed job'); });
    assert.equal(restored.call('POST', '', { url: 'https://example.com/article' }).data.job.id, id);
    assert.equal(count, 1); restored.control.stop();
  } finally { release(); f.control.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('administrator can retry a failed job without exposing provider details or losing journal history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-web-queue-'));
  let count = 0;
  const f = fixture(dir, async (url, progress) => { count++; progress('rewrite'); if (count === 1) throw Error('secret provider credential'); return { entryId: 'entry', title: '完成' }; });
  try {
    const id = f.call('POST', '', { url: 'https://example.com/fail' }).data.job.id;
    await tick();
    const failed = f.call('GET', '/' + id).data.job;
    assert.equal(failed.status, 'failed'); assert.equal(failed.stage, 'rewrite');
    assert.ok(!JSON.stringify(failed).includes('secret'));
    assert.equal(f.call('POST', '/' + id + '/retry', {}, { role: 'user' }).code, 403);
    assert.equal(f.call('POST', '/' + id + '/retry').code, 202);
    assert.equal(f.call('POST', '/' + id + '/retry').code, 200);
    await tick(); assert.equal(f.call('GET', '/' + id).data.job.status, 'complete');
    assert.equal(count, 2); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'lab-collection-jobs.json'))).length, 1);
  } finally { f.control.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('deleted results stay deleted and the shared queue limits additional work', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-web-queue-'));
  const journal = path.join(dir, 'lab-collection-jobs.json');
  fs.writeFileSync(journal, JSON.stringify([{ id: crypto.randomUUID(), url: 'https://example.com/deleted', entryId: 'deleted', status: 'complete', createdAt: Date.now() },
    ...Array.from({ length: 30 }, (_, i) => ({ id: crypto.randomUUID(), url: 'https://example.com/' + i, status: 'queued', createdAt: Date.now() }))]));
  const f = fixture(dir, () => new Promise(() => {}));
  try {
    assert.equal(f.call('POST', '', { url: 'https://example.com/deleted' }).code, 403);
    assert.equal(f.call('GET').data.jobs.length, 30);
    assert.equal(f.call('POST', '', { url: 'https://example.com/new' }).code, 429);
    assert.equal(JSON.parse(fs.readFileSync(journal)).length, 31);
  } finally { f.control.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('website jobs interrupted during translation resume after restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-web-queue-'));
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(dir, 'lab-collection-jobs.json'), JSON.stringify([{ id, url: 'https://example.com/resume', status: 'running', stage: 'translation', createdAt: Date.now() }]));
  const f = fixture(dir, async (url, progress) => { progress('rewrite'); return { entryId: 'restored', title: '恢复完成' }; });
  try { await tick(); assert.equal(f.call('GET', '/' + id).data.job.status, 'complete'); assert.equal(f.call('GET', '/' + id).data.job.entryId, 'restored'); }
  finally { f.control.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('failure reasons distinguish timeout, quota and incomplete output without echoing provider secrets', async () => {
  const cases = [
    [Object.assign(new Error('request timed out sk-private'), { name: 'TimeoutError' }), 'timeout'],
    [Object.assign(new Error('provider response sk-private'), { statusCode: 429 }), 'quota'],
    [new Error('translation coverage check failed sk-private'), 'incomplete'],
    [new Error('request failed: 401 sk-private'), 'credentials'],
    [new TypeError('fetch failed sk-private'), 'network'],
  ];
  for (const [error, expected] of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-web-queue-'));
    const f = fixture(dir, async (url, progress) => { progress('translation'); throw error; });
    try {
      const id = f.call('POST', '', { url: 'https://example.com/failure' }).data.job.id;
      await tick();
      const result = f.call('GET', '/' + id).data.job;
      assert.equal(result.failure, expected); assert.equal(result.status, 'failed');
      assert.ok(!JSON.stringify(result).includes('sk-private'));
      assert.ok(!fs.readFileSync(path.join(dir, 'lab-collection-jobs.json'), 'utf8').includes('sk-private'));
    } finally { f.control.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
