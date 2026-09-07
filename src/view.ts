import { FuzzySuggestModal, ItemView, Menu, Notice, setIcon, setTooltip, type App, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { articleFragment } from './content';
import { modeLabels, modeSchema, safeUrl, titleOf, type Bundle, type Entry, type Mode, type Source } from './model';
export const VIEW_TYPE = 'qiaomu-ai-rss-reader';
type Filter = 'all' | 'unread' | 'favorites';
class ChannelPicker extends FuzzySuggestModal<Source> {
  constructor(app: App, private sources: Source[], private choose: (source: Source) => void) {
    super(app); this.setPlaceholder('搜索频道…');
  }
  getItems() { return [{ id: '', name: '所有频道' }, ...this.sources.filter(source => source.enabled !== false)]; }
  getItemText(source: Source) { return source.name; }
  onChooseItem(source: Source) { this.choose(source); }
}
export class ReaderView extends ItemView {
  private list!: HTMLElement;
  private reader!: HTMLElement;
  private status!: HTMLElement;
  private channelButton!: HTMLButtonElement;
  private searchBox!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private refreshButton!: HTMLButtonElement;
  private filters!: HTMLElement;
  private entries: Entry[] = [];
  private source = '';
  private filter: Filter = 'all';
  private query = '';
  private cursor = '';
  private hasMore = false;
  private loading = false;
  private articleLoading = false;
  private focused = false;
  private listVersion = 0;
  private articleVersion = 0;
  private renderVersion = 0;
  private bundle: Bundle | null = null;
  private mode: Mode;
  private closed = false;
  private message = '';
  private blobUrls: string[] = [];
  private imageObserver?: IntersectionObserver;
  constructor(leaf: WorkspaceLeaf, private plugin: QiaomuRssPlugin) {
    super(leaf); this.mode = plugin.state.settings.defaultMode;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Qiaomu AI RSS'; }
  getIcon() { return 'rss'; }
  onOpen(): Promise<void> { this.reset(); return Promise.resolve(); }
  onClose(): Promise<void> {
    this.closed = true; this.listVersion++; this.articleVersion++; this.clearImages(); this.contentEl.onkeydown = null;
    return Promise.resolve();
  }
  reset() {
    this.closed = false; this.listVersion++; this.articleVersion++;
    this.source = ''; this.cursor = ''; this.bundle = null; this.loading = false; this.hasMore = false;
    this.mode = this.plugin.state.settings.defaultMode; this.entries = this.plugin.state.entries;
    this.build(); this.renderList(); this.renderReader(); void this.loadEntries();
  }
  private run(action: () => Promise<void>) {
    void action().catch(error => { if (!this.closed) new Notice(error instanceof Error ? error.message : '操作失败，请重试。'); });
  }
  private addIconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'qrs-icon', attr: { 'aria-label': label } });
    setIcon(button, icon); setTooltip(button, label); button.addEventListener('click', action); return button;
  }
  private build() {
    const root = this.contentEl; root.empty(); root.addClass('qrs-root'); root.removeClass('qrs-has-article');
    root.toggleClass('qrs-focus', this.focused); root.tabIndex = 0;
    root.setCssProps({ '--qrs-list-width': `${this.plugin.state.settings.listWidth}px` });
    const body = root.createDiv('qrs-layout');
    const sidebar = body.createEl('aside', { cls: 'qrs-sidebar', attr: { 'aria-label': '文章导航' } });
    const bar = sidebar.createDiv('qrs-sidebar-toolbar');
    this.channelButton = bar.createEl('button', { cls: 'qrs-channel', attr: { 'aria-label': '选择频道', 'aria-haspopup': 'dialog' } });
    this.renderChannel(); this.channelButton.addEventListener('click', () => this.pickChannel());
    this.addIconButton(bar, 'search', '搜索文章 /', () => this.toggleSearch());
    this.refreshButton = this.addIconButton(bar, 'refresh-cw', '刷新文章', () => { void this.loadEntries(); });
    this.filters = sidebar.createDiv({ cls: 'qrs-filters', attr: { role: 'group', 'aria-label': '阅读筛选' } });
    this.renderFilters();
    this.searchBox = sidebar.createDiv('qrs-search-box'); this.searchBox.toggleClass('is-hidden', !this.query);
    this.searchInput = this.searchBox.createEl('input', { type: 'search', placeholder: '搜索当前列表…', attr: { 'aria-label': '搜索已载入文章' } });
    this.searchInput.value = this.query;
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value; this.renderList(); });
    this.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.toggleSearch(false); } });
    this.status = sidebar.createDiv({ cls: 'qrs-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.list = sidebar.createDiv({ cls: 'qrs-list', attr: { 'aria-label': '文章列表' } });
    this.createResizeHandle(body);
    this.reader = body.createEl('section', { cls: 'qrs-reader', attr: { 'aria-label': '文章阅读区', tabindex: '0' } });
    root.onkeydown = event => this.onReaderKey(event);
  }
  private renderChannel() {
    this.channelButton.empty();
    this.channelButton.createSpan({ text: this.plugin.state.sources.find(s => s.id === this.source)?.name || '所有频道' });
    setIcon(this.channelButton.createSpan(), 'chevron-down');
  }
  private renderFilters() {
    this.filters.empty();
    for (const [value, label] of [['all', '全部'], ['unread', '未读'], ['favorites', '收藏']] as const) {
      const button = this.filters.createEl('button', { text: label, attr: { 'aria-pressed': String(value === this.filter), 'data-filter': value } });
      button.addEventListener('click', () => { this.filter = value; this.renderFilters(); this.renderList(); });
    }
  }
  private pickChannel() {
    new ChannelPicker(this.app, this.plugin.state.sources, source => this.selectSource(source.id)).open();
  }
  private selectSource(source: string) {
    this.source = source; this.cursor = ''; this.entries = []; this.hasMore = false;
    this.bundle = null; this.articleVersion++; this.contentEl.removeClass('qrs-has-article');
    this.renderChannel(); this.renderReader(); this.renderList(); void this.loadEntries();
  }
  private toggleSearch(show = this.searchBox.hasClass('is-hidden')) {
    this.focused = false; this.contentEl.removeClass('qrs-focus'); this.contentEl.removeClass('qrs-has-article');
    this.searchBox.toggleClass('is-hidden', !show);
    if (show) this.searchInput.focus();
    else { this.query = ''; this.searchInput.value = ''; this.renderList(); this.contentEl.focus(); }
  }
  private createResizeHandle(parent: HTMLElement) {
    const handle = parent.createDiv({ cls: 'qrs-resize', attr: { role: 'separator', tabindex: '0', 'aria-label': '调整文章列表宽度', 'aria-orientation': 'vertical', 'aria-valuemin': '220', 'aria-valuemax': '520', 'aria-valuenow': String(this.plugin.state.settings.listWidth) } });
    const resize = (width: number) => {
      const next = Math.round(Math.max(220, Math.min(520, width)));
      this.plugin.state.settings.listWidth = next;
      this.contentEl.setCssProps({ '--qrs-list-width': `${next}px` });
      handle.setAttribute('aria-valuenow', String(next));
    };
    handle.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault(); handle.setPointerCapture(event.pointerId); handle.addClass('is-dragging');
      const x = event.clientX; const width = this.plugin.state.settings.listWidth;
      handle.onpointermove = move => resize(width + move.clientX - x);
    };
    const finish = () => { handle.onpointermove = null; handle.removeClass('is-dragging'); this.run(() => this.plugin.persist()); };
    handle.onpointerup = finish; handle.onlostpointercapture = finish; handle.onpointercancel = finish;
    handle.ondblclick = () => { resize(300); this.run(() => this.plugin.persist()); };
    handle.onkeydown = event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); resize(this.plugin.state.settings.listWidth + (event.key === 'ArrowLeft' ? -20 : 20)); this.run(() => this.plugin.persist());
    };
  }
  private toggleFocus() {
    if (!this.bundle) return;
    if (this.contentEl.clientWidth <= 650) { this.contentEl.removeClass('qrs-has-article'); return; }
    this.focused = !this.focused; this.contentEl.toggleClass('qrs-focus', this.focused); this.renderReader(true);
  }
  private onReaderKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing ||
      (target?.closest?.('input,textarea,select,[contenteditable=true]'))) return;
    if (event.key === 'j' || event.key === 'k') { event.preventDefault(); this.navigate(event.key === 'j' ? 1 : -1); }
    if (event.key === '[' || event.key === 'f') { event.preventDefault(); this.toggleFocus(); }
    if (event.key === '/') { event.preventDefault(); this.toggleSearch(true); }
    if (event.key === 'Escape') { this.focused = false; this.contentEl.removeClass('qrs-focus'); this.contentEl.removeClass('qrs-has-article'); }
  }
  private navigate(direction: number) {
    const entries = this.visibleEntries(); const index = entries.findIndex(entry => entry.id === this.bundle?.entry.id);
    const next = entries[index + direction]; if (next) void this.openArticle(next);
  }
  private async loadEntries(more = false) {
    if (this.loading && more) return;
    const version = ++this.listVersion; this.loading = true; this.status.setText(''); this.refreshButton.addClass('is-loading');
    const state = this.plugin.state;
    try {
      const api = this.plugin.api();
      const [page, sources] = await Promise.allSettled([api.entries(this.source, more ? this.cursor : ''), api.sources()]);
      if (this.closed || version !== this.listVersion) return;
      if (sources.status === 'fulfilled') { state.sources = sources.value.sources; this.renderChannel(); }
      if (page.status === 'rejected') throw page.reason;
      this.entries = more ? [...new Map([...this.entries, ...page.value.entries].map(entry => [entry.id, entry])).values()] : page.value.entries;
      this.cursor = page.value.nextCursor || ''; this.hasMore = !!page.value.hasMore && !!this.cursor;
      if (!this.source) { state.entries = this.entries; state.updatedAt = Date.now(); }
      await this.plugin.persist();
      if (this.closed || version !== this.listVersion) return;
      this.status.setText(sources.status === 'rejected' ? '频道加载失败，请刷新重试。' : '');
    } catch (error) {
      if (this.closed || version !== this.listVersion) return;
      this.status.setText(`${error instanceof Error ? error.message : '网络不可用。'}${this.entries.length ? ' 正在显示缓存。' : ' 点击刷新重试。'}`);
    } finally {
      if (!this.closed && version === this.listVersion) { this.loading = false; this.refreshButton.removeClass('is-loading'); this.renderList(); }
    }
  }
  private visibleEntries(): Entry[] {
    const state = this.plugin.state;
    const entries = this.filter === 'favorites' ? Object.values(state.favorites).map(b => b.entry) : this.entries;
    const query = this.query.trim().toLocaleLowerCase();
    return entries.filter(entry => (!this.source || entry.sourceId === this.source) &&
      (this.filter !== 'unread' || !state.readIds.includes(entry.id) || entry.id === this.bundle?.entry.id) &&
      (!query || `${titleOf(entry)} ${entry.title} ${entry.summary || ''} ${this.sourceName(entry)}`.toLocaleLowerCase().includes(query)));
  }
  private sourceName(entry: Entry) { return this.plugin.state.sources.find(source => source.id === entry.sourceId)?.name || entry.sourceId; }
  private excerpt(entry: Entry): string {
    if (entry.summaryZh) return entry.summaryZh;
    const text = entry.rewrite?.body.split('\n\n').find(line => /[\u3400-\u9fff]/.test(line) && !line.startsWith('#') && !line.startsWith('!['));
    return (text || entry.summary || '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#]/g, '').slice(0, 160);
  }
  private renderList() {
    const scroll = this.list.scrollTop; this.list.empty(); const entries = this.visibleEntries();
    if (!entries.length) this.list.createDiv({ cls: 'qrs-empty', text: this.loading ? '正在获取文章…' : this.filter === 'favorites' ? '收藏喜欢的文章，在这里慢慢读。' : '暂无匹配文章，试试其他频道或筛选。' });
    for (const entry of entries) {
      const read = this.plugin.state.readIds.includes(entry.id);
      const row = this.list.createEl('button', { cls: 'qrs-entry', attr: { 'aria-label': titleOf(entry), 'data-entry-id': entry.id } });
      row.toggleClass('qrs-selected', this.bundle?.entry.id === entry.id);
      row.setAttribute('aria-pressed', String(this.bundle?.entry.id === entry.id)); row.toggleClass('qrs-read', read);
      const meta = row.createSpan('qrs-entry-meta');
      meta.createSpan({ text: this.sourceName(entry), cls: 'qrs-source-name' });
      const date = entry.publishedTs ? new Date(entry.publishedTs) : entry.published ? new Date(entry.published) : null;
      meta.createSpan({ cls: 'qrs-date', text: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '' });
      const title = row.createDiv('qrs-entry-title');
      title.createSpan({ cls: read ? 'qrs-read-dot' : 'qrs-unread-dot', attr: { 'aria-label': read ? '已读' : '未读' } });
      title.createEl('h3', { text: titleOf(entry) });
      if (this.plugin.state.favorites[entry.id]) setIcon(title.createSpan('qrs-bookmarked'), 'bookmark');
      const summary = this.excerpt(entry); if (summary) row.createEl('p', { text: summary, cls: 'qrs-summary' });
      row.addEventListener('click', () => { void this.openArticle(entry); });
    }
    if (this.hasMore && this.filter !== 'favorites') {
      const button = this.list.createEl('button', { text: this.loading ? '加载中…' : '加载更早文章', cls: 'qrs-more' });
      button.disabled = this.loading; button.addEventListener('click', () => { void this.loadEntries(true); });
    }
    this.list.scrollTop = scroll;
  }
  private async openArticle(entry: Entry) {
    const version = ++this.articleVersion; const state = this.plugin.state;
    this.bundle = state.cache[entry.id] || state.favorites[entry.id] || { entry, rewrite: entry.rewrite ?? null, translation: null, fetchedAt: 0 };
    state.readIds = [...new Set([...state.readIds, entry.id])].slice(-5000); this.run(() => this.plugin.persist());
    this.mode = state.settings.defaultMode; this.message = ''; this.articleLoading = true; this.reader.setAttribute('aria-busy', 'true');
    this.contentEl.addClass('qrs-has-article'); this.renderReader(); this.reader.scrollTop = 0; this.reader.focus({ preventScroll: true }); this.renderList();
    try {
      const { bundle, warnings } = await this.plugin.api().article(entry.id);
      if (this.closed || version !== this.articleVersion) return;
      this.bundle = bundle; this.message = warnings.join('；'); this.plugin.remember(bundle); await this.plugin.persist();
    } catch (error) {
      if (this.closed || version !== this.articleVersion) return;
      const cached = this.bundle.fetchedAt ? ` 正在显示 ${new Date(this.bundle.fetchedAt).toLocaleString()} 的缓存。` : ' 可重新打开文章重试。';
      this.message = `${error instanceof Error ? error.message : '获取正文失败。'}${cached}`;
    }
    if (!this.closed && version === this.articleVersion) { this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false'); this.renderReader(); this.renderList(); }
  }
  private saveCurrent() {
    const bundle = this.bundle; if (!bundle) return;
    this.run(async () => {
      const file = await this.plugin.saveArticle(bundle, this.mode, this.reader.ownerDocument);
      new Notice('笔记已保存。'); await this.app.workspace.getLeaf('tab').openFile(file);
    });
  }
  private clearImages() {
    this.renderVersion++; this.imageObserver?.disconnect(); this.imageObserver = undefined;
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];
  }
  private prepareImages(fragment: DocumentFragment) {
    const version = this.renderVersion;
    const load = async (img: HTMLImageElement, url: string, holder: HTMLElement) => {
      holder.querySelector('button')?.remove();
      try {
        const blob = await this.plugin.images.load(url);
        if (this.closed || version !== this.renderVersion) return;
        const local = URL.createObjectURL(blob); this.blobUrls.push(local); img.src = local;
        img.onload = () => holder.removeClass('is-loading');
      } catch {
        if (this.closed || version !== this.renderVersion) return;
        holder.removeClass('is-loading');
        const button = holder.createEl('button', { text: '图片加载失败 · 重试', cls: 'qrs-image-retry' });
        button.onclick = () => { void load(img, url, holder); };
      }
    };
    this.imageObserver = new IntersectionObserver(items => {
      for (const item of items) {
        if (!item.isIntersecting) continue;
        const img = item.target as HTMLImageElement; this.imageObserver?.unobserve(img);
        const url = img.dataset.qrsImage;
        if (url && img.parentElement) void load(img, url, img.parentElement);
      }
    }, { root: this.reader, rootMargin: '500px' });
    for (const img of fragment.querySelectorAll('img')) {
      const url = img.getAttribute('src'); img.removeAttribute('src'); if (!url) { img.remove(); continue; }
      img.dataset.qrsImage = url;
      const holder = createSpan({ cls: 'qrs-image is-loading' });
      img.replaceWith(holder); holder.append(img); this.imageObserver.observe(img);
    }
  }
  private renderReader(keepContent = false) {
    const scroll = this.reader.scrollTop;
    const previous = keepContent ? this.reader.querySelector('.qrs-article') : null;
    if (!previous) this.clearImages();
    this.reader.empty(); const bundle = this.bundle;
    if (!bundle) {
      const empty = this.reader.createDiv('qrs-welcome'); setIcon(empty.createDiv('qrs-welcome-icon'), 'book-open');
      empty.createEl('h2', { text: '选一篇，开始读。' }); empty.createEl('p', { text: '上下篇：j / k · 收起列表：[ · 搜索：/' }); return;
    }
    const toolbar = this.reader.createDiv('qrs-reader-toolbar');
    this.addIconButton(toolbar, this.focused ? 'panel-left-open' : 'panel-left-close', '显示或收起文章列表 [', () => this.toggleFocus());
    const select = toolbar.createEl('select', { cls: 'qrs-mode-select', attr: { 'aria-label': '阅读版本' } });
    for (const [mode, label] of Object.entries(modeLabels)) select.createEl('option', { value: mode, text: label });
    select.value = this.mode; select.onchange = () => { this.mode = modeSchema.parse(select.value); this.renderReader(); };
    const nav = toolbar.createDiv('qrs-reader-nav');
    this.addIconButton(nav, 'chevron-up', '上一篇 K', () => this.navigate(-1));
    this.addIconButton(nav, 'chevron-down', '下一篇 J', () => this.navigate(1));
    const actions = toolbar.createDiv('qrs-actions');
    const favorite = !!this.plugin.state.favorites[bundle.entry.id];
    const bookmark = this.addIconButton(actions, 'bookmark', favorite ? '取消收藏' : '收藏文章', () => this.run(async () => {
      if (favorite) delete this.plugin.state.favorites[bundle.entry.id]; else this.plugin.state.favorites[bundle.entry.id] = bundle;
      await this.plugin.persist(); this.renderReader(true); this.renderList();
    }));
    bookmark.setAttribute('aria-pressed', String(favorite)); bookmark.toggleClass('is-bookmarked', favorite);
    const read = this.plugin.state.readIds.includes(bundle.entry.id);
    const readButton = this.addIconButton(actions, read ? 'circle-check' : 'circle', read ? '标为未读' : '标为已读', () => this.run(async () => {
      const ids = this.plugin.state.readIds.filter(id => id !== bundle.entry.id);
      this.plugin.state.readIds = read ? ids : [...ids, bundle.entry.id].slice(-5000);
      await this.plugin.persist(); this.renderReader(true); this.renderList();
    }));
    readButton.setAttribute('aria-pressed', String(read));
    this.addIconButton(actions, 'file-plus-2', '保存为笔记', () => this.saveCurrent());
    const more = this.addIconButton(actions, 'ellipsis', '更多文章操作', () => {
      const menu = new Menu(); const link = safeUrl(bundle.entry.link || '');
      if (link) menu.addItem(item => item.setTitle('在浏览器打开原文').setIcon('external-link').onClick(() => { this.contentEl.win.open(link, '_blank', 'noopener,noreferrer'); }));
      menu.addItem(item => item.setTitle('重新加载文章').setIcon('refresh-cw').onClick(() => { void this.openArticle(bundle.entry); }));
      menu.addItem(item => item.setTitle('选择频道').setIcon('rss').onClick(() => this.pickChannel()));
      const rect = more.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
    });
    if (previous) { this.reader.append(previous); this.reader.scrollTop = scroll; return; }
    const article = this.reader.createEl('article', { cls: 'qrs-article' });
    const metadata = article.createDiv('qrs-article-meta');
    metadata.createSpan({ text: this.sourceName(bundle.entry) });
    const date = bundle.entry.publishedTs ? new Date(bundle.entry.publishedTs) : null;
    if (date) metadata.createSpan({ text: date.toLocaleDateString() });
    if (this.mode !== 'original') { const ai = metadata.createSpan({ text: 'AI ' + (this.mode === 'rewrite' ? '改写' : '翻译'), cls: 'qrs-ai-label' }); setTooltip(ai, 'AI 生成内容，请结合原文核对。'); }
    article.createEl('h1', { text: titleOf(bundle.entry) });
    if (this.message) article.createDiv({ cls: 'qrs-feedback', text: this.message, attr: { role: 'status' } });
    try {
      const fragment = articleFragment(bundle, this.mode, article.ownerDocument, this.plugin.state.settings.remoteImages);
      if (fragment) { this.prepareImages(fragment); article.createDiv('qrs-prose').append(fragment); }
      else article.createDiv({ cls: 'qrs-empty', text: this.articleLoading ? '正在获取正文…' : `${modeLabels[this.mode]}暂无正文。可以切换版本，或从“更多”中打开原文。` });
    } catch { article.createDiv({ cls: 'qrs-empty', text: '正文无法显示，请打开原文阅读。' }); }
    this.reader.scrollTop = scroll;
  }
}
