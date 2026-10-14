(() => {
  'use strict';
  if (typeof state === 'undefined' || typeof api !== 'function' || typeof isAdmin !== 'function') return;
  const menu = document.querySelector('#article-link-menu');
  if (!menu || !document.querySelector('#reader-pane')) return;
  const makeButton = (id, text) => {
    const button = document.createElement('button');
    button.id = id; button.type = 'button'; button.textContent = text;
    return button;
  };
  const enqueue = makeButton('article-link-enqueue', '加入转写队列');
  const viewQueue = makeButton('article-link-queue', '查看转写队列');
  for (const button of [enqueue, viewQueue]) { button.setAttribute('role', 'menuitem'); button.classList.add('hidden'); menu.append(button); }
  let pending = false, timer = 0, loading = false, modal = null, rows = [], cursor = '', previousFocus = null;
  const labels = { queued: '等待处理', fetch: '正在抓取', translation: '正在翻译', rewrite: '正在中文改写', complete: '已完成', failed: '失败' };
  const syncButtons = () => {
    for (const button of [enqueue, viewQueue]) button.classList.toggle('hidden', !isAdmin());
    enqueue.disabled = pending;
  };
  const pageFragment = value => {
    try { const url = new URL(value, location.href); return Boolean(url.hash && url.origin === location.origin && url.pathname === location.pathname && url.search === location.search); }
    catch { return true; }
  };
  const linkFrom = target => {
    const anchor = articleContentLinkFromTarget(target);
    return anchor && !pageFragment(anchor.href) ? anchor : null;
  };
  document.addEventListener('pointerdown', syncButtons, true);
  document.querySelector('#reader-pane').addEventListener('contextmenu', event => {
    if (!isAdmin()) return;
    const anchor = linkFrom(event.target);
    if (!anchor) return;
    syncButtons(); suppressAnnotationPopoverForLink();
    if (!showArticleLinkMenu(anchor, event)) return;
    event.preventDefault(); event.stopPropagation();
    previousFocus = anchor;
    enqueue.focus({ preventScroll: true });
  }, true);
  menu.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { hideArticleLinkMenu(); previousFocus?.focus?.(); return; }
    const buttons = [...menu.querySelectorAll('button')].filter(b => !b.classList.contains('hidden') && !b.disabled);
    let index = buttons.indexOf(document.activeElement);
    index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  });
  new MutationObserver(syncButtons).observe(menu, { attributes: true, attributeFilter: ['class'] });

  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.id = 'web-collection-modal'; modal.className = 'modal hidden';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'web-collection-title');
    modal.innerHTML = `<div class="modal-box web-collection-box"><header><div><h2 id="web-collection-title">转写队列</h2><p>网页抓取 → 翻译 → 中文改写 · 仅管理员可见</p></div><button type="button" class="icon-btn" id="web-collection-close" aria-label="关闭转写队列">${typeof iconMarkup === 'function' ? iconMarkup('x') : '×'}</button></header><div class="web-collection-toolbar"><span id="web-collection-message" role="status" aria-live="polite"></span><button type="button" class="ghost-btn" id="web-collection-refresh">刷新</button></div><div id="web-collection-list" role="list" aria-label="链接处理任务"></div><button type="button" class="ghost-btn hidden" id="web-collection-more">加载更多</button></div>`;
    document.body.append(modal);
    modal.querySelector('#web-collection-close').onclick = closeQueue;
    modal.querySelector('#web-collection-refresh').onclick = () => { void refreshQueue(); };
    modal.querySelector('#web-collection-more').onclick = () => { void refreshQueue(true); };
    modal.onclick = event => { if (event.target === modal) closeQueue(); };
    modal.querySelector('#web-collection-list').onclick = async event => {
      const button = event.target.closest('button[data-job-action]');
      if (!button || !isAdmin()) return;
      const job = rows.find(row => row.id === button.dataset.jobId);
      if (!job) return;
      button.disabled = true;
      try {
        if (button.dataset.jobAction === 'open') {
          await openEntryById(job.entryId, { tab: 'rewrite', updateUrl: true }); closeQueue();
        } else {
          const data = await api(`/api/admin/collection-jobs/${encodeURIComponent(job.id)}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          rows = rows.map(row => row.id === data.job.id ? data.job : row); renderQueue(); schedule();
        }
      } catch (error) { modal.querySelector('#web-collection-message').textContent = error.message || '操作失败，请重试'; }
      finally { button.disabled = false; }
    };
  }
  function closeQueue() {
    modal?.classList.add('hidden'); clearTimeout(timer);
    previousFocus?.focus?.({ preventScroll: true });
  }
  function renderQueue() {
    const list = modal.querySelector('#web-collection-list');
    const scroll = list.scrollTop;
    const focus = list.contains(document.activeElement) ? { ...document.activeElement.dataset } : null;
    list.replaceChildren();
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'web-collection-empty'; empty.textContent = '暂无链接任务'; list.append(empty); }
    for (const job of rows) {
      const row = document.createElement('article'); row.className = 'web-collection-row'; row.setAttribute('role', 'listitem');
      const copy = document.createElement('div'); copy.className = 'web-collection-copy';
      const title = document.createElement('strong'); title.textContent = job.title || job.url;
      const url = document.createElement('span'); url.className = 'web-collection-url'; url.textContent = job.url;
      const status = document.createElement('span'); status.className = 'web-collection-state';
      status.textContent = job.status === 'failed' ? `${job.error || '处理未完成'} · 可重试` : labels[job.stage] || labels[job.status] || '等待处理';
      const meta = document.createElement('small'); meta.textContent = `${job.submitter || '管理员'} · ${new Date(job.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
      copy.append(title, url, status, meta); row.append(copy);
      if (job.status === 'complete' && job.entryId || job.status === 'failed') {
        const button = makeButton('', job.status === 'complete' ? '打开文章' : '重试'); button.className = 'ghost-btn';
        button.dataset.jobAction = job.status === 'complete' ? 'open' : 'retry'; button.dataset.jobId = job.id; row.append(button);
      }
      list.append(row);
    }
    modal.querySelector('#web-collection-more').classList.toggle('hidden', !cursor);
    list.scrollTop = scroll;
    if (focus?.jobId) [...list.querySelectorAll('button')].find(button => button.dataset.jobId === focus.jobId && button.dataset.jobAction === focus.jobAction)?.focus({ preventScroll: true });
  }
  function schedule() {
    clearTimeout(timer);
    if (modal && !modal.classList.contains('hidden') && !document.hidden) timer = setTimeout(() => { void refreshQueue(); }, 5000);
  }
  async function refreshQueue(more = false) {
    if (!isAdmin()) { rows = []; closeQueue(); return; }
    if (loading) return;
    clearTimeout(timer);
    loading = true;
    const message = modal.querySelector('#web-collection-message');
    const button = modal.querySelector(more ? '#web-collection-more' : '#web-collection-refresh'); button.disabled = true;
    try {
      const data = await api('/api/admin/collection-jobs' + (more && cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
      if (!isAdmin()) { rows = []; closeQueue(); return; }
      rows = more ? [...rows, ...data.jobs.filter(job => !rows.some(row => row.id === job.id))] : data.jobs;
      cursor = data.nextCursor || ''; message.textContent = `${rows.length} 个任务 · ${more ? '点击刷新查看最新进度' : '每 5 秒更新'}`; renderQueue();
    } catch (error) { message.textContent = error.message || '队列读取失败，请重试'; }
    finally { loading = false; button.disabled = false; if (!more) schedule(); }
  }
  function openQueue() {
    if (!isAdmin()) return;
    hideArticleLinkMenu(); ensureModal(); modal.classList.remove('hidden');
    modal.querySelector('#web-collection-close').focus(); void refreshQueue();
  }
  enqueue.onclick = async () => {
    const url = state.articleLinkMenuUrl;
    if (!isAdmin() || !url || pending || pageFragment(url)) return;
    const anchor = [...document.querySelectorAll('#reader-content a, #rewrite-content a, #translation-list a')].find(a => articleContentLinkUrl(a) === url);
    const title = anchor?.textContent?.trim().slice(0, 300) || '';
    pending = true; syncButtons(); hideArticleLinkMenu();
    try {
      const data = await api('/api/admin/collection-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), url, title }) });
      toast(data.duplicate ? '此链接已有任务，可在队列查看' : '已加入转写队列');
      if (isAdmin()) openQueue();
    } catch (error) { toast('加入队列失败：' + error.message, 5000); }
    finally { pending = false; syncButtons(); }
  };
  viewQueue.onclick = openQueue;
  document.addEventListener('keydown', event => {
    if (!modal || modal.classList.contains('hidden')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeQueue(); }
    if (event.key === 'Tab') {
      const targets = [...modal.querySelectorAll('button:not(:disabled)')].filter(b => !b.classList.contains('hidden'));
      const index = targets.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && index === targets.length - 1) { event.preventDefault(); targets[event.shiftKey ? targets.length - 1 : 0]?.focus(); }
    }
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else if (modal && !modal.classList.contains('hidden')) void refreshQueue(); });
  // A durable entry point in the existing administrator page, including after reload.
  const adminPage = document.querySelector('#admin-page');
  if (adminPage) {
    const entry = makeButton('admin-web-collection-open', '转写队列'); entry.className = 'ghost-btn web-collection-entry';
    entry.onclick = () => { previousFocus = entry; openQueue(); };
    const section = adminPage.querySelector('#admin-manage-status');
    if (section) section.before(entry); else adminPage.prepend(entry);
  }
  syncButtons();
})();
