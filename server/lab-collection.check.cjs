const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { mountLabCollection } = require('./lab-collection');
function fixture(directory, processLink) {
  const routes = {}, sessions = new Map();
  const clientId = '11111111-1111-4111-8111-111111111111', clientKey = 'x'.repeat(72);
  const adminAuth = {
    authenticateUser(email,password) { if (email==='admin@example.com'&&password==='admin-pass') return { id:'admin',role:'admin',displayName:'Admin' }; if(password==='user-pass')return{id:'ordinary',role:'user'};throw Error('invalid'); },
    createSession(id, ttl) { assert.equal(ttl,365 * 24 * 3600000); const token=crypto.randomUUID();sessions.set(token,{id,role:'admin'});return{token,expiresAt:Date.now()+3600000}; },
    getUserBySessionToken(token){return sessions.get(token);},
    deleteSession(token){sessions.delete(token);},
  };
  const app = { post: (path, ...handlers) => routes['POST ' + path] = handlers, get: (path, ...handlers) => routes['GET ' + path] = handlers };
  const control = mountLabCollection(app, { directory, processLink, adminAuth, codes: () => 'test-invite', validateUrl: url => { if (!url.startsWith('https://example.com/')) throw Error('invalid'); return url; } });
  function call(method, body = {}, id = '', token = 'test-invite', endpoint, identity = { clientId, clientKey }, query = {}) {
    const req = { body, params: { id }, query, ip: 'qa', get: name => ({ authorization:`Bearer ${token}`, 'x-qiaomu-client':identity.clientId, 'x-qiaomu-client-key':identity.clientKey })[name.toLowerCase()] };
    const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(data) { this.data = data; return this; } };
    const handlers = routes[method + ' ' + (endpoint || (method === 'POST' ? '/api/lab/collection-jobs' : '/api/lab/collection-jobs/:id'))];
    const run = i => handlers[i]?.(req, res, () => run(i+1)); run(0); return res;
  }
  const journal = path.join(directory, 'lab-collection-jobs.json');
  const claimIds = fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal,'utf8')).map(j=>j.id) : [];
  assert.equal(call('POST',{ clientId,clientKey,claimIds },'','test-invite','/api/lab/verify').statusCode,200);
  return { call, control };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
test('server verifies invite, deduplicates jobs, exposes only ready results, and restores its journal', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qrs-lab-test-'));
  let calls = 0;
  const processLink = async () => { calls++; await settle(); return { entryId: 'entry', title: 'Actual result' }; };
  const { call, control } = fixture(directory, processLink);
  const id = crypto.randomUUID();
  try {
    assert.equal(call('POST', { id, url: 'https://example.com/article' }, '', 'invalid').statusCode, 403);
    assert.equal(calls, 0);
    assert.equal(call('POST', { id, url: 'http://localhost/internal' }).statusCode, 400);
    assert.equal(call('POST', { id, url: 'https://example.com/article' }).statusCode, 202);
    assert.equal(call('POST', { id, url: 'https://example.com/article' }).statusCode, 200);
    assert.equal(call('POST', { id, url: 'https://example.com/other' }).statusCode, 409);
    assert.equal(call('GET', {}, id).data.status, 'running');
    await settle(); await settle();
    assert.equal(calls, 1);
    assert.deepEqual(call('GET', {}, id).data, { status: 'complete', stage: 'complete', title: 'Actual result', originalTitle: 'Actual result', entryId: 'entry' });
    assert.equal(call('GET', {}, id, 'invalid').statusCode, 403);
    control.stop();
    const restored = fixture(directory, processLink);
    assert.equal(restored.call('GET', {}, id).data.status, 'complete');
    restored.control.stop();
    assert.ok(!fs.readFileSync(path.join(directory, 'lab-collection-jobs.json'), 'utf8').includes('test-invite'));
  } finally { control.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('failed jobs never masquerade as completed and interrupted jobs resume', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qrs-lab-test-'));
  const id = crypto.randomUUID();
  const owner = crypto.createHash('sha256').update('test-invite').digest('hex');
  fs.writeFileSync(path.join(directory, 'lab-collection-jobs.json'), JSON.stringify([{ id, owner, url: 'https://example.com/article', status: 'running', createdAt: Date.now() }]));
  const f = fixture(directory, async () => { throw Error('provider secret must not leak'); });
  try {
    await settle();
    assert.deepEqual(f.call('GET', {}, id).data, { status: 'failed', stage: 'queued', failure: 'unknown', title: '' });
    assert.equal(f.call('GET', {}, crypto.randomUUID()).statusCode, 404);
  } finally { f.control.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('limits real new work while retries remain idempotent', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qrs-lab-test-'));
  const f = fixture(directory, async () => { throw Error('controlled failure'); });
  try {
    const requests = [];
    for (let n=0; n<6; n++) {
      const body = { id: crypto.randomUUID(), url: 'https://example.com/' + n };
      requests.push(body);
      assert.equal(f.call('POST', body).statusCode, 202);
    }
    assert.equal(f.call('POST', { id: crypto.randomUUID(), url: 'https://example.com/overflow' }).statusCode, 429);
    assert.equal(f.call('POST', requests[0]).statusCode, 200);
    await settle();
  } finally { f.control.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('shared invitation never grants another client records or administrative access', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qrs-lab-test-'));
  const f = fixture(directory, async () => ({entryId:'entry',title:'Result'}));
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const identity = { clientId: crypto.randomUUID(), clientKey: 'y'.repeat(72) };
  try {
    f.call('POST',{id:first,url:'https://example.com/first'});
    assert.equal(f.call('POST',identity,'','test-invite','/api/lab/verify',identity).statusCode,200);
    f.call('POST',{id:second,url:'https://example.com/second'},'','test-invite',undefined,identity);
    await settle();
    assert.deepEqual(f.call('GET',{},'','test-invite','/api/lab/collection-jobs').data.jobs.map(j=>j.id),[first]);
    assert.deepEqual(f.call('GET',{},'','test-invite','/api/lab/collection-jobs',identity).data.jobs.map(j=>j.id),[second]);
    assert.equal(f.call('GET',{},first,'test-invite',undefined,identity).statusCode,404);
    assert.equal(f.call('GET',{},'','test-invite','/api/lab/admin/collection-jobs').statusCode,403);
    assert.equal(f.call('POST',{email:'admin@example.com',password:'bad'},'','','/api/lab/admin/session').statusCode,403);
    assert.equal(f.call('POST',{email:'user@example.com',password:'user-pass'},'','','/api/lab/admin/session').statusCode,403);
    const login=f.call('POST',{email:'admin@example.com',password:'admin-pass'},'','','/api/lab/admin/session');
    assert.equal(login.statusCode,200);
    const token=login.data.token;
    const all=f.call('GET',{},'',token,'/api/lab/admin/collection-jobs');
    assert.equal(all.data.jobs.length,2);
    assert.ok(all.data.jobs.every(j=>j.submitter));
    assert.ok(!JSON.stringify(all.data).includes('keyHash'));
    assert.equal(f.call('POST',{},'',token,'/api/lab/admin/logout').statusCode,200);
    assert.equal(f.call('GET',{},'',token,'/api/lab/admin/collection-jobs').statusCode,403);
  } finally {f.control.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
