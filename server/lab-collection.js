// Install in QMReader lib/. No client-chosen model or provider is accepted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Return fixed categories only; provider response bodies may contain credentials.
function failureCode(error) {
  const message = String(error?.message || '');
  const status = Number(error?.statusCode || error?.status || 0);
  if (status === 413 || /过长.*结构块|structure exceeds request limit/i.test(message)) return 'structure';
  if (/timeout|timed out|超时/i.test(message) || ['TimeoutError', 'AbortError'].includes(error?.name)) return 'timeout';
  if (status === 429 || /rate.?limit|quota|额度|request failed: 429/i.test(message)) return 'quota';
  if ([401, 403].includes(status) || /not configured|api.?key|unauthorized|authentication|request failed: (401|403)/i.test(message)) return 'credentials';
  if (/漏译|不完整|重复或越界|coverage|preserv|structure|empty|not ready|incomplete|truncat|max.?tokens|输出.*(?:截断|中断)/i.test(message)) return 'incomplete';
  if (status >= 500 || error?.name === 'TypeError' || /fetch failed|network|ECONN|ENOTFOUND/i.test(message)) return 'network';
  return 'unknown';
}

function mountLabCollection(app, { directory, processLink, validateUrl, codes = () => process.env.QIAOMU_LAB_INVITE_CODES || '', adminAuth }) {
  const file = path.join(directory, 'lab-collection-jobs.json');
  const clientsFile = path.join(directory, 'lab-collection-clients.json');
  const clients = fs.existsSync(clientsFile) ? JSON.parse(fs.readFileSync(clientsFile, 'utf8')) : {};
  let jobs = [];
  if (fs.existsSync(file)) {
    jobs = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(jobs)) throw new Error('Invalid lab collection journal');
    for (const job of jobs) if (job.status === 'running') { job.status = 'queued'; job.stage = 'queued'; }
  }
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const save = () => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(jobs), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  };
  const publicJob = job => ({ id: job.id, url: job.url, createdAt: job.createdAt, ...view(job) });
  const clientAuth = (req, res, next) => {
    const client = clients[req.get('x-qiaomu-client')];
    if (!client || client.owner !== req.labOwner || client.keyHash !== digest(String(req.get('x-qiaomu-client-key') || ''))) return res.status(403).json({ error: 'invalid_client' });
    req.labClient = client.id; return next();
  };
  const view = job => {
    const title = job.entryId && adminAuth?.getTitleTranslations?.([job.entryId])?.[job.entryId];
    return { status: job.status, ...(job.stage ? { stage: job.stage } : {}), ...(job.failure ? { failure: job.failure } : {}), title: title || job.title || '', ...(job.originalTitle || title ? { originalTitle: job.originalTitle || job.title } : {}), ...(job.entryId ? { entryId: job.entryId } : {}) };
  };
  const auth = (req, res, next) => {
    const token = String(req.get('authorization') || '').replace(/^Bearer /, '');
    const hash = digest(token);
    if (!token || !codes().split(',').map(code => code.trim()).filter(Boolean).some(code => crypto.timingSafeEqual(Buffer.from(digest(code)), Buffer.from(hash)))) return res.status(403).json({ error: 'invalid_invitation' });
    req.labOwner = hash;
    res.setHeader('Cache-Control', 'no-store');
    return next();
  };
  app.post('/api/lab/verify', auth, (req, res) => {
    const id = String(req.body?.clientId || ''), key = String(req.body?.clientKey || '');
    if (!/^[a-f0-9-]{36}$/i.test(id) || key.length < 36 || key.length > 200) return res.status(400).json({ error: 'invalid_client' });
    const existing = clients[id];
    if (existing && (existing.keyHash !== digest(key))) return res.status(403).json({ error: 'invalid_client' });
    const oldClient = clients[id];
    clients[id] = { id, owner: req.labOwner, keyHash: digest(key), label: existing?.label || `用户 ${Object.keys(clients).length + 1}` };
    const claimIds = Array.isArray(req.body?.claimIds) ? req.body.claimIds.slice(0, 2000) : [];
    const claimed = [];
    for (const job of jobs) if (!job.clientId && job.owner === req.labOwner && claimIds.includes(job.id)) { job.clientId = id; claimed.push(job); }
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(clientsFile + '.tmp', JSON.stringify(clients), { mode: 0o600 });
      fs.renameSync(clientsFile + '.tmp', clientsFile);
      save();
    } catch {
      if (oldClient) clients[id] = oldClient; else delete clients[id];
      for (const job of claimed) delete job.clientId;
      return res.status(503).json({ error: 'journal_unavailable' });
    }
    return res.json({ verified: true });
  });
  const page = (req, list, admin = false) => {
    list = list.filter(job => !job.entryId || !adminAuth?.isEntryDeleted?.(job.entryId));
    const ordered = [...list].sort((a,b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const after = String(req.query?.cursor || '');
    const found = after ? ordered.findIndex(job => job.id === after) : -1;
    const start = found + 1, selected = ordered.slice(start, start + 100);
    const hasMore = start + selected.length < ordered.length;
    return { jobs: selected.map(job => ({ ...publicJob(job), ...(admin ? { submitter: job.adminName || clients[job.clientId]?.label || '旧版用户' } : {}) })), hasMore, nextCursor: hasMore ? selected.at(-1).id : '' };
  };
  app.get('/api/lab/collection-jobs', auth, (req, res) => clientAuth(req, res, () => res.json(page(req, jobs.filter(job => job.clientId === req.labClient)))));
  const adminAttempts = new Map();
  const admin = (req, res, next) => {
    const token = String(req.get('authorization') || '').replace(/^Bearer /, '');
    const user = adminAuth?.getUserBySessionToken(token);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
    req.labAdminToken = token; res.setHeader('Cache-Control', 'no-store'); return next();
  };
  app.post('/api/lab/admin/session', (req, res) => {
    const key = req.ip || 'unknown', now = Date.now();
    const attempt = adminAttempts.get(key) || { started: now, count: 0 };
    if (now - attempt.started > 600000) { attempt.started = now; attempt.count = 0; }
    if (adminAttempts.size > 1000) adminAttempts.delete(adminAttempts.keys().next().value);
    adminAttempts.set(key, attempt);
    if (++attempt.count > 10) return res.status(429).json({ error: 'rate_limited' });
    try {
      const user = adminAuth.authenticateUser(String(req.body?.email || ''), String(req.body?.password || ''));
      if (user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
      const session = adminAuth.createSession(user.id, 365 * 24 * 3600000);
      return res.json({ token: session.token, expiresAt: session.expiresAt, name: user.displayName || user.email });
    } catch { return res.status(403).json({ error: 'admin_required' }); }
  });
  app.get('/api/lab/admin/collection-jobs', admin, (req, res) => res.json(page(req, jobs, true)));
  app.post('/api/lab/admin/logout', admin, (req, res) => { adminAuth.deleteSession(req.labAdminToken); res.json({ verified: false }); });
  let active = false;
  let stopped = false;
  async function drain() {
    if (active || stopped) return;
    active = true;
    try {
      for (;;) {
        const job = jobs.find(job => job.status === 'queued');
        if (!job || stopped) break;
        job.status = 'running'; save();
        try {
          job.startedAt = Date.now();
          const result = await processLink(job.url, stage => {
            if (!['fetch', 'translation', 'rewrite'].includes(stage)) return;
            job.stage = stage; job.updatedAt = Date.now(); save();
          });
          if (!result.entryId) throw new Error('No result');
          job.title = String(result.title || '').slice(0, 300);
          job.originalTitle = String(result.originalTitle || result.title || '').slice(0, 300);
          job.entryId = result.entryId;
          job.status = 'complete';
          job.stage = 'complete';
          delete job.failure;
        } catch (error) {
          job.status = 'failed'; job.failure = failureCode(error);
          console.warn('[rss-link-queue]', JSON.stringify({ id: job.id, stage: job.stage || 'processing', failure: job.failure }));
        }
        job.updatedAt = Date.now();
        save();
      }
    } finally { active = false; }
  }
  app.post('/api/lab/collection-jobs', auth, (req, res) => clientAuth(req, res, () => {
    const id = String(req.body?.id || '');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return res.status(400).json({ error: 'invalid_request_id' });
    let url;
    try { url = validateUrl(String(req.body?.url || '')); } catch { return res.status(400).json({ error: 'invalid_url' }); }
    const existing = jobs.find(job => job.id === id);
    if (existing) {
      if (existing.clientId !== req.labClient || existing.url !== url) return res.status(409).json({ error: 'request_conflict' });
      return res.status(200).json(view(existing));
    }
    const now = Date.now();
    const recent = jobs.filter(job => job.createdAt > now - 86400000);
    if (full() || recent.filter(job => job.owner === req.labOwner).length >= 20 || recent.filter(job => job.owner === req.labOwner && job.createdAt > now - 3600000).length >= 6) return res.status(429).json({ error: 'rate_limited' });
    const job = { id, url, owner: req.labOwner, clientId: req.labClient, status: 'queued', title: '', createdAt: now };
    jobs.push(job);
    try { save(); } catch { jobs.pop(); return res.status(503).json({ error: 'journal_unavailable' }); }
    res.status(202).json(view(job));
    void drain().catch(() => { stopped = true; });
  }));
  app.get('/api/lab/collection-jobs/:id', auth, (req, res) => clientAuth(req, res, () => {
    const job = jobs.find(job => job.id === req.params.id && job.clientId === req.labClient);
    return job ? res.json(view(job)) : res.status(404).json({ error: 'not_found' });
  }));
  // Website authentication is set by QMReader's session-cookie middleware. It
  // does not use the shared invitation or issue another administrative session.
  const websiteAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员登录' });
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (origin) {
        try { if (new URL(origin).host !== req.get('host')) throw Error('cross-site'); }
        catch { return res.status(403).json({ error: '拒绝跨站操作' }); }
      }
    }
    res.setHeader('Cache-Control', 'no-store'); return next();
  };
  const webJob = job => ({ ...publicJob(job), stage: job.stage || job.status,
    submitter: job.adminName || clients[job.clientId]?.label || '旧版用户',
    updatedAt: job.updatedAt || job.createdAt,
    ...(job.status === 'failed' ? { failure: job.failure || 'unknown', error: (({ fetch: '网页抓取失败', translation: '翻译未完成', rewrite: '中文改写未完成' })[job.stage] || '处理未完成') + '：' + (({ timeout: '请求超时，请重试', quota: '服务额度或频率受限，请稍后重试', credentials: '服务凭据不可用，请检查配置', incomplete: '生成结果不完整，请重试', network: '服务连接失败，请稍后重试' })[job.failure] || '请重试') } : {}),
    retries: job.queueAttempts?.length ? job.queueAttempts.length - 1 : 0 });
  const deleted = job => Boolean(job.entryId && adminAuth?.isEntryDeleted?.(job.entryId));
  const full = () => {
    const now = Date.now();
    const attempts = jobs.flatMap(j => j.queueAttempts || [j.createdAt]);
    return stopped || jobs.filter(j => ['queued', 'running'].includes(j.status)).length >= 30 || attempts.filter(t => t > now - 86400000).length >= 60;
  };
  const startDrain = () => { void drain().catch(() => { stopped = true; }); };
  app.get('/api/admin/collection-jobs', websiteAdmin, (req, res) => {
    const result = page(req, jobs, true);
    const byId = new Map(jobs.map(job => [job.id, job]));
    result.jobs = result.jobs.map(job => webJob(byId.get(job.id)));
    res.json(result);
  });
  app.get('/api/admin/collection-jobs/:id', websiteAdmin, (req, res) => {
    const job = jobs.find(j => j.id === req.params.id);
    return job && !deleted(job) ? res.json({ job: webJob(job) }) : res.status(404).json({ error: '任务不存在' });
  });
  app.post('/api/admin/collection-jobs', websiteAdmin, (req, res) => {
    let url;
    try { url = validateUrl(String(req.body?.url || '')); }
    catch { return res.status(400).json({ error: '请使用公开网页的 HTTP/HTTPS 链接' }); }
    const id = String(req.body?.id || crypto.randomUUID());
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return res.status(400).json({ error: '无效请求标识' });
    const sameId = jobs.find(j => j.id === id);
    if (sameId && sameId.url !== url) return res.status(409).json({ error: '请求标识已用于其他链接' });
    if (jobs.some(j => j.url === url && deleted(j))) return res.status(403).json({ error: '这个链接已被管理员移除' });
    const existing = sameId || [...jobs].reverse().find(j => j.url === url);
    if (existing) return res.json({ job: webJob(existing), duplicate: true });
    if (full()) return res.status(stopped ? 503 : 429).json({ error: stopped ? '队列暂不可用，请稍后重试' : '队列已满或达到每日额度，请稍后重试' });
    const now = Date.now();
    const job = { id, url, owner: 'web-admin:' + req.user.id, adminName: String(req.user.displayName || '管理员').slice(0, 80),
      status: 'queued', stage: 'queued', title: String(req.body?.title || '').slice(0, 300), createdAt: now, queueAttempts: [now] };
    jobs.push(job);
    try { save(); } catch { jobs.pop(); return res.status(503).json({ error: '任务保存失败，请稍后重试' }); }
    res.status(202).json({ job: webJob(job) }); startDrain();
  });
  app.post('/api/admin/collection-jobs/:id/retry', websiteAdmin, (req, res) => {
    const job = jobs.find(j => j.id === req.params.id);
    if (!job || deleted(job)) return res.status(404).json({ error: '任务不存在' });
    if (job.status !== 'failed') return res.json({ job: webJob(job), duplicate: true });
    if (stopped) return res.status(503).json({ error: '队列暂不可用，请稍后重试' });
    if (full() || (job.queueAttempts?.length || 1) >= 6) return res.status(429).json({ error: '重试达到额度，请稍后再试' });
    const previous = { ...job };
    job.status = 'queued'; job.stage = 'queued'; job.updatedAt = Date.now();
    delete job.failure;
    job.queueAttempts = [...(job.queueAttempts || [job.createdAt]), Date.now()];
    try { save(); } catch { for (const key of Object.keys(job)) if (!(key in previous)) delete job[key]; Object.assign(job, previous); return res.status(503).json({ error: '任务保存失败，请稍后重试' }); }
    res.status(202).json({ job: webJob(job) }); startDrain();
  });
  // Interrupted jobs are retried after restart, using existing collected entries and cached rewrites.
  void drain().catch(() => { stopped = true; });
  return { stop: () => { stopped = true; } };
}
module.exports = { mountLabCollection };
