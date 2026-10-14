const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { isolated } = require('./process.cjs');
const { watch } = require('./watchdog.cjs');
const { validate } = require('./remote-result.cjs');
const { evaluate } = require('./health.cjs');
const { requestJson } = require('./request-json.js');
test('a transport ignoring cancellation is killed; the next source still finishes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-timeout-'));
  try {
    fs.writeFileSync(path.join(root, 'hang.cjs'), "process.on('message',()=>{setInterval(()=>{},1000);process.on('SIGTERM',()=>{})});");
    fs.writeFileSync(path.join(root, 'good.cjs'), "process.on('message',()=>process.send({ok:true,result:{entries:[1]}},()=>process.exit(0)));");
    await assert.rejects(isolated(path.join(root, 'hang.cjs'), {}, { timeout: 200 }), { code: 'SOURCE_TIMEOUT' });
    assert.deepEqual(await isolated(path.join(root, 'good.cjs'), {}, { timeout: 2000 }), { entries: [1] });
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('watchdog detects business stalls even if the process is alive and repeats heartbeat', () => {
  const worker = new EventEmitter(); const killed = []; worker.kill = signal => killed.push(signal); worker.exitCode = 0;
  let now = 0; const w = watch(worker, { now: () => now, idleMs: 100, maxMs: 1000, log: () => {} });
  worker.emit('message', { type: 'progress', done: 73, total: 74 });
  now = 50; worker.emit('message', { type: 'progress', done: 73, total: 74 });
  now = 101; w.tick(); w.stop(); assert.deepEqual(killed, ['SIGTERM']);
});
test('remote import rejects stale, cross-source and oversized data and strips privileged fields', () => {
  const source = { id: 'feed' }, result = { status: 'ok', fetchedAt: Date.now(), entries: [{ id: 'id', sourceId: 'feed', title: 'title', deletedAt: 0, user: { admin: true }, assets: { rewrite: true } }] };
  assert.equal(validate(source, result)[0].deletedAt, undefined);
  assert.equal(validate(source, result)[0].user, undefined);
  assert.equal(validate(source, result)[0].assets, undefined);
  assert.throws(() => validate({ id: 'other' }, result));
  assert.throws(() => validate(source, { ...result, fetchedAt: Date.now() - 13 * 3600000 }));
  assert.throws(() => validate(source, { ...result, entries: [...result.entries, { ...result.entries[0], content: 'x'.repeat(3000001) }] }));
});
test('HTTP 200 with no new successful fetch is critical; unselected sources do not count', () => {
  const now = Date.now();
  assert.equal(evaluate([{ id: 'feed', enabled: true, fetchedAt: now - 3 * 3600000 }], {}, now).status, 'critical');
  assert.equal(evaluate([{ id: 'feed', enabled: true, fetchedAt: now }, { id: 'unselected', enabled: true, optIn: true }], {}, now).status, 'ok');
  assert.equal(evaluate([{ id: 'feed', enabled: true, fetchedAt: now }], { fetch: { running: true, job: { startedAt: now - 46 * 60000 } } }, now).stalled, true);
});
test('web JSON body stall is bounded and a GET retries once', async () => {
  let calls = 0;
  // Warm the native HTTP types before starting the request clock; cold loading on CI
  // must not consume the intentionally reduced test deadline.
  const ready = new Response(JSON.stringify({ entries: [1] }));
  const headers = new Headers();
  const result = await requestJson('/api/entries', { timeoutMs: 1000 }, { fetch: async () => {
    calls++; if (calls === 1) return { ok: true, headers, text: () => new Promise(() => {}) };
    return ready;
  } });
  assert.deepEqual(result, { entries: [1] }); assert.equal(calls, 2);
});
test('web writes and 401/429 never replay, and exhausted timeout fails visibly', async () => {
  for (const status of [401, 429, 503]) {
    let calls = 0;
    await assert.rejects(requestJson('/api/write', { method: 'POST', timeoutMs: 80 }, { fetch: async () => { calls++; return new Response('{"error":"denied"}', { status }); } }));
    assert.equal(calls, 1);
  }
  for (const status of [401, 429]) {
    let calls = 0;
    await assert.rejects(requestJson('/api/read', { timeoutMs: 1000 }, { fetch: async () => { calls++; return new Response('{"error":"denied"}', { status }); } }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(requestJson('/api/read', { timeoutMs: 60 }, { fetch: () => { calls++; return new Promise(() => {}); } }), /超时/);
  assert.equal(calls, 2);
});
test('web explicit cancellation does not retry or masquerade as timeout', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(requestJson('/api/read', { signal: controller.signal, timeoutMs: 30 }, { fetch: async () => { calls++; throw Object.assign(Error('abort'), { name: 'AbortError' }); } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('failed primary routes to standby and keeps credentials out of the payload', async () => {
  const oldTarget = process.env.RSS_FETCH_SSH_TARGET;
  const oldDirectory = process.env.QMREADER_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-routing-'));
  process.env.QMREADER_DATA_DIR = directory;
  process.env.RSS_FETCH_SSH_TARGET = 'restricted@example.test';
  const calls = [];
  const remote = { status: 'ok', fetchedAt: Date.now(), entries: [{ id: 'id', sourceId: 'feed', title: 'Title' }] };
  const fetcher = { loadDisk() {}, acceptRemoteResult: (source, result) => { assert.equal(source.id, 'feed'); return result; } };
  try {
    require('./bounded-fetch.cjs').install(fetcher, { run: async (file, input, options) => {
      calls.push({ input, options });
      if (file) throw Object.assign(Error('timeout'), { code: 'SOURCE_TIMEOUT' });
      return remote;
    } });
    assert.equal(await fetcher.fetchSource({ id: 'feed', name: 'Feed', feeds: ['https://example.test/rss'], apiKey: 'private-test', accounts: ['private'] }), remote);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.ssh, true);
    assert.equal(calls[1].input.source.apiKey, undefined);
    assert.equal(calls[1].input.source.accounts, undefined);
  } finally {
    if (oldTarget === undefined) delete process.env.RSS_FETCH_SSH_TARGET; else process.env.RSS_FETCH_SSH_TARGET = oldTarget;
    if (oldDirectory === undefined) delete process.env.QMREADER_DATA_DIR; else process.env.QMREADER_DATA_DIR = oldDirectory;
    fs.rmSync(directory, { recursive: true });
  }
});
