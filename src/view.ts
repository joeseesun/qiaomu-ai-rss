import { Component, MarkdownRenderer, ItemView, Menu, Modal, Notice, setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { vaultSourceId } from './vault-source';
import { SelectionCapture } from './selection';
import { readingFonts } from './fonts';
import { articleFragment } from './content';
import { modeLabels, modeSchema, readingFontSchema, safeUrl, titleOf, type Bundle, type Entry, type Mode } from './model';
export const VIEW_TYPE = 'qiaomu-ai-rss-reader';
type Filter = 'all' | 'unread' | 'favorites';
type ChannelSection = '聚合' | '订阅分组' | '乔木频道' | '我的订阅源' | '库内文件夹';
interface ChannelChoice { id: string; name: string; section: ChannelSection; subtitle: string; icon?: string; monogram?: string }
function channelMark(parent: HTMLElement, choice: ChannelChoice) {
  const mark = parent.createSpan('qrs-channel-mark');
  if (choice.icon) setIcon(mark, choice.icon); else mark.setText(choice.monogram || choice.name.trim().slice(0, 1).toLocaleUpperCase());
  return mark;
}
function feedHost(url: string) {
  try { return new URL(url).hostname || 'RSS'; } catch { return 'RSS'; }
}
class ChannelPicker extends Modal {
  private query = '';
  constructor(app: App, private choices: ChannelChoice[], private active: string, private choose: (source: ChannelChoice) => void) {
    super(app);
  }
  onOpen() {
    this.modalEl.addClass('qrs-channel-modal'); this.setTitle('选择频道');
    const searchId = `qrs-channel-search-${crypto.randomUUID()}`;
    this.contentEl.createEl('label', { cls: 'qrs-visually-hidden', text: '搜索频道', attr: { for: searchId } });
    const input = this.contentEl.createEl('input', { type: 'search', cls: 'qrs-channel-search', placeholder: '搜索频道、分组或订阅源…', attr: { id: searchId } });
    const list = this.contentEl.createDiv('qrs-channel-list');
    const render = () => {
      list.empty(); const query = this.query.trim().toLocaleLowerCase();
      const matches = this.choices.filter(choice => !query || `${choice.name} ${choice.subtitle}`.toLocaleLowerCase().includes(query));
      for (const section of ['聚合', '订阅分组', '乔木频道', '我的订阅源', '库内文件夹'] as const) {
        const choices = matches.filter(choice => choice.section === section); if (!choices.length) continue;
        const group = list.createEl('section', { cls: 'qrs-channel-section' }); group.createEl('h3', { text: section });
        for (const choice of choices) {
          const row = group.createEl('button', { cls: 'qrs-channel-row', attr: { 'data-channel-id': choice.id } }); row.toggleClass('is-active', choice.id === this.active);
          channelMark(row, choice); const text = row.createSpan('qrs-channel-copy');
          text.createSpan({ cls: 'qrs-channel-name', text: choice.name }); text.createSpan({ cls: 'qrs-channel-subtitle', text: choice.subtitle });
          if (choice.id === this.active) setIcon(row.createSpan('qrs-channel-check'), 'check');
          row.onclick = () => { this.close(); this.choose(choice); };
        }
      }
      if (!matches.length) list.createDiv({ cls: 'qrs-channel-empty', text: '没有匹配的频道。' });
    };
    input.oninput = () => { this.query = input.value; render(); }; render(); input.focus();
  }
  onClose() { this.contentEl.empty(); }
}
export class ReaderView extends ItemView {
  private markdownComponent?: Component;
  private selectionCapture?: SelectionCapture;
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
  private unreadSession = new Set<string>();
  private query = '';
  private cursor = '';
  private hasMore = false;
  private loading = false;
  private articleLoading = false;
  private focused = false;
  private appearanceOpen = false;
  private appearanceId = `qrs-reading-settings-${crypto.randomUUID()}`;
  private listVersion = 0;
  private articleVersion = 0;
  private renderVersion = 0;
  private bundle: Bundle | null = null;
  private mode: Mode;
  private closed = false;
  private message = '';
  private blobUrls: string[] = [];
  private thumbnailUrls = new Map<string, string>();
  private thumbnailPending = new Map<string, Promise<string | null>>();
  private thumbnailVersion = 0;
  private imageObserver?: IntersectionObserver;
  constructor(leaf: WorkspaceLeaf, private plugin: QiaomuRssPlugin) {
    super(leaf); this.mode = plugin.state.settings.defaultMode;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Qiaomu AI RSS'; }
  getIcon() { return 'rss'; }
  onOpen(): Promise<void> {
    this.reset();
    this.selectionCapture = new SelectionCapture(this.contentEl.ownerDocument, () => this.reader, () => {
      const bundle = this.bundle, mode = this.mode;
      if (!bundle || !this.plugin.state.settings.selectionPopup) return null;
      return async text => {
        try {
          this.plugin.remember(bundle);
          const result = await this.plugin.noteArticle(bundle.entry, text, mode);
          new Notice(result.added ? '摘录已添加到今日日记。' : '这段摘录已在今日日记中。');
        } catch (error) { new Notice(error instanceof Error ? error.message : '摘录失败，请重试。'); }
      };
    });
    return Promise.resolve();
  }
  onClose(): Promise<void> {
    this.selectionCapture?.dispose();
    this.closed = true; this.listVersion++; this.articleVersion++; this.clearImages(); this.clearThumbnails(); this.contentEl.onkeydown = null;
    return Promise.resolve();
  }
  reset() {
    this.unreadSession.clear();
    this.closed = false; this.listVersion++; this.articleVersion++; this.clearThumbnails();
    const remembered = this.plugin.state.settings.lastSource;
    const localExists = this.plugin.state.subscriptions.some(feed => feed.id === remembered);
    const groupExists = remembered.startsWith('@group:') && this.plugin.state.subscriptions.some(feed => feed.group === remembered.slice(7));
    this.focused = false; this.source = remembered === '@local' || this.plugin.state.settings.markdownFolders.some(folder => vaultSourceId(folder) === remembered) || groupExists || localExists || this.plugin.state.sources.some(source => source.id === remembered) ? remembered : '';
    this.cursor = ''; this.bundle = null; this.loading = false; this.hasMore = false;
    this.mode = this.plugin.state.settings.defaultMode;
    this.entries = this.personalScope() ? this.localEntries() : this.source ? [] : this.plugin.state.entries;
    this.build(); this.renderList(); this.renderReader(); void this.loadEntries();
  }
  private run(action: () => Promise<void>) {
    void action().catch(error => { if (!this.closed) new Notice(error instanceof Error ? error.message : '操作失败，请重试。'); });
  }
  private addIconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'qrs-icon', attr: { 'data-qrs-label': label } });
    setIcon(button, icon); button.createSpan({ cls: 'qrs-visually-hidden', text: label }); button.addEventListener('click', action); return button;
  }
  refreshPreferences() { this.selectionCapture?.clear(); this.applyAppearance(); if (this.appearanceOpen) this.renderReader(true); }
  private applyAppearance() {
    const settings = this.plugin.state.settings;
    this.contentEl.dataset.readingFont = settings.fontFamily;
    const font = readingFonts.find(font => font.id === settings.fontFamily)!;
    this.contentEl.setCssProps({ '--qrs-font-family': font.data ? `"${font.family}",serif` : font.family });
    void this.plugin.fonts.load(this.contentEl.ownerDocument, settings.fontFamily).catch(() => {
      if (!this.closed && this.plugin.state.settings.fontFamily === font.id) new Notice('字体加载失败，请重新选择重试。');
    });
    this.contentEl.setCssProps({
      '--qrs-font-size': `${settings.fontSize}px`, '--qrs-line-height': String(settings.lineHeight),
      '--qrs-article-width': `${settings.fontSize * settings.lineWidth + 120}px`,
    });
  }
  private build() {
    const root = this.contentEl; root.empty(); root.addClass('qrs-root'); root.removeClass('qrs-has-article');
    root.toggleClass('qrs-focus', this.focused); root.tabIndex = 0;
    root.setCssProps({ '--qrs-list-width': `${this.plugin.state.settings.listWidth}px` }); this.applyAppearance();
    const body = root.createDiv('qrs-layout');
    const sidebar = body.createEl('aside', { cls: 'qrs-sidebar' });
    const bar = sidebar.createDiv('qrs-sidebar-toolbar');
    this.channelButton = bar.createEl('button', { cls: 'qrs-channel', attr: { 'aria-haspopup': 'dialog' } });
    this.renderChannel(); this.channelButton.addEventListener('click', () => this.pickChannel());
    this.addIconButton(bar, 'plus', '添加或管理订阅', () => this.plugin.manageSubscriptions());
    this.addIconButton(bar, 'search', '搜索文章 /', () => this.toggleSearch());
    this.refreshButton = this.addIconButton(bar, 'refresh-cw', '刷新文章', () => { void this.loadEntries(false, true); });
    this.filters = sidebar.createDiv({ cls: 'qrs-filters', attr: { role: 'group' } });
    this.renderFilters();
    this.searchBox = sidebar.createDiv('qrs-search-box'); this.searchBox.toggleClass('is-hidden', !this.query);
    const searchId = `${this.appearanceId}-search`; this.searchBox.createEl('label', { cls: 'qrs-visually-hidden', text: '搜索已载入文章', attr: { for: searchId } });
    this.searchInput = this.searchBox.createEl('input', { type: 'search', placeholder: '搜索当前列表…', attr: { id: searchId } });
    this.searchInput.value = this.query;
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value; this.unreadSession.clear(); this.renderList(); });
    this.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.toggleSearch(false); } });
    this.status = sidebar.createDiv({ cls: 'qrs-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.list = sidebar.createDiv({ cls: 'qrs-list' });
    this.createResizeHandle(body);
    this.reader = body.createEl('section', { cls: 'qrs-reader', attr: { tabindex: '0' } });
    root.onkeydown = event => this.onReaderKey(event);
  }
  private renderChannel() {
    this.channelButton.empty();
    const choices = this.channelChoices();
    const choice = choices.find(item => item.id === this.source) || choices[0];
    channelMark(this.channelButton, choice); this.channelButton.createSpan({ cls: 'qrs-channel-label', text: choice.name });
    setIcon(this.channelButton.createSpan(), 'chevron-down');
  }
  private renderFilters() {
    this.filters.empty();
    for (const [value, label] of [['all', '全部'], ['unread', '未读'], ['favorites', '收藏']] as const) {
      const button = this.filters.createEl('button', { text: label, attr: { 'aria-pressed': String(value === this.filter), 'data-filter': value } });
      button.addEventListener('click', () => { this.filter = value; this.unreadSession.clear(); this.renderFilters(); this.renderList(); });
    }
  }
  private channelChoices(): ChannelChoice[] {
    const feeds = this.plugin.state.subscriptions;
    const groups = [...new Set(feeds.map(feed => feed.group).filter(Boolean))].sort();
    return [
      { id: '', name: '乔木精选', section: '聚合', subtitle: '乔木筛选的高质量内容', icon: 'sparkles' },
      { id: '@local', name: '我的订阅', section: '聚合', subtitle: `${feeds.length} 个个人订阅源`, icon: 'rss' },
      ...this.plugin.state.settings.markdownFolders.map(folder => ({ id: vaultSourceId(folder), name: folder === '/' ? '整个库' : folder.split('/').at(-1)!, section: '库内文件夹' as const, subtitle: folder, icon: 'folder-open' })),
      ...groups.map(group => ({ id: `@group:${group}`, name: group, section: '订阅分组' as const,
        subtitle: `${feeds.filter(feed => feed.group === group).length} 个订阅源`, icon: 'folder' })),
      ...this.plugin.state.sources.filter(source => source.enabled !== false).map(source => ({ id: source.id, name: source.name, section: '乔木频道' as const,
        subtitle: ({ article: '文章', news: '新闻', podcast: '播客' } as Record<string, string>)[source.category || ''] || source.category || '乔木内容频道', monogram: source.name.trim().slice(0, 1) })),
      ...feeds.map(feed => ({ id: feed.id, name: feed.name, section: '我的订阅源' as const,
        subtitle: `${feed.group ? `${feed.group} · ` : ''}${feedHost(feed.url)} · ${feed.entries.length} 篇`, monogram: feed.name.trim().slice(0, 1) })),
    ];
  }
  private vaultScope() { return this.source.startsWith('@vault:'); }
  private personalScope() { return this.source === '@local' || this.source.startsWith('@group:') || this.source.startsWith('local:'); }
  private selectedFeeds() {
    return this.plugin.state.subscriptions.filter(feed => this.source === '@local' || feed.id === this.source ||
      (this.source.startsWith('@group:') && feed.group === this.source.slice(7)));
  }
  private localEntries() { return this.selectedFeeds().flatMap(feed => feed.entries).sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0)); }
  showSubscriptions() { this.selectSource('@local', false); }
  showSubscription(id: string) {
    if (this.plugin.state.subscriptions.some(feed => feed.id === id)) this.selectSource(id, false);
  }
  private pickChannel() {
    new ChannelPicker(this.app, this.channelChoices(), this.source, source => this.selectSource(source.id)).open();
  }
  private selectSource(source: string, refresh = true) {
    this.unreadSession.clear();
    this.listVersion++; this.loading = false; this.refreshButton.removeClass('is-loading');
    this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false');
    this.source = source; this.cursor = ''; this.entries = []; this.hasMore = false;
    this.plugin.state.settings.lastSource = source; this.run(() => this.plugin.persist());
    this.bundle = null; this.articleVersion++; this.focused = false;
    this.contentEl.removeClass('qrs-focus'); this.contentEl.removeClass('qrs-has-article');
    this.entries = this.personalScope() ? this.localEntries() : source ? [] : this.plugin.state.entries;
    this.status.setText(''); this.renderChannel(); this.renderReader(); this.renderList();
    if (refresh) void this.loadEntries();
  }
  private toggleSearch(show = this.searchBox.hasClass('is-hidden')) {
    this.focused = false; this.contentEl.removeClass('qrs-focus'); this.contentEl.removeClass('qrs-has-article');
    this.searchBox.toggleClass('is-hidden', !show);
    if (show) this.searchInput.focus();
    else { this.query = ''; this.searchInput.value = ''; this.unreadSession.clear(); this.renderList(); this.contentEl.focus(); }
  }
  private createResizeHandle(parent: HTMLElement) {
    const labelId = `${this.appearanceId}-resize`; const handle = parent.createDiv({ cls: 'qrs-resize', attr: { role: 'separator', tabindex: '0', 'aria-labelledby': labelId, 'aria-orientation': 'vertical', 'aria-valuemin': '220', 'aria-valuemax': '520', 'aria-valuenow': String(this.plugin.state.settings.listWidth) } });
    handle.createSpan({ cls: 'qrs-visually-hidden', text: '调整文章列表宽度', attr: { id: labelId } });
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
    if (event.key === 'Escape' && this.appearanceOpen) {
      event.preventDefault(); event.stopPropagation(); this.appearanceOpen = false; this.renderReader(true); return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing ||
      (target?.closest?.('input,textarea,select,[contenteditable=true]'))) return;
    const key = event.key.toLowerCase();
    if (key === 'j' || key === 'k') { event.preventDefault(); event.stopPropagation(); this.navigate(key === 'j' ? 1 : -1); }
    if (event.key === '[' || event.key === 'f') { event.preventDefault(); this.toggleFocus(); }
    if (event.key === '/') { event.preventDefault(); this.toggleSearch(true); }
    if (event.key === 'Escape') { this.focused = false; this.contentEl.removeClass('qrs-focus'); this.contentEl.removeClass('qrs-has-article'); }
  }
  private navigate(direction: number) {
    const entries = this.visibleEntries(); const index = entries.findIndex(entry => entry.id === this.bundle?.entry.id);
    const next = entries[index + direction]; if (next) void this.openArticle(next);
  }
  private async loadEntries(more = false, force = false) {
    if (this.loading && more) return;
    const version = ++this.listVersion; this.loading = true; this.status.setText(''); this.refreshButton.addClass('is-loading');
    const state = this.plugin.state;
    try {
      if (this.vaultScope()) { this.entries = this.plugin.vaultSources.entries(this.source.slice(7)); this.hasMore = false; return; }
      if (this.personalScope()) {
        const feeds = this.selectedFeeds();
        await this.plugin.subscriptions.refresh(feeds.map(feed => feed.id), this.reader.ownerDocument, force, () => {
          if (!this.closed && version === this.listVersion) { this.entries = this.localEntries(); this.renderList(); }
        });
        if (this.closed || version !== this.listVersion) return;
        this.entries = this.localEntries(); this.hasMore = false;
        const failed = feeds.filter(feed => feed.error).length;
        this.status.setText(failed ? `${failed} 个订阅刷新失败，保留已有文章。可在订阅管理中查看详情。` : '');
        return;
      }
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
    return entries.filter(entry => (this.vaultScope() ? entry.origin === 'vault' && entry.sourceId === this.source : this.personalScope()
      ? entry.origin === 'local' && (this.source === '@local' || this.selectedFeeds().some(feed => feed.id === entry.sourceId))
      : entry.origin !== 'local' && entry.origin !== 'vault' && (!this.source || entry.sourceId === this.source)) &&
      (this.filter !== 'unread' || !state.readIds.includes(entry.id) || this.unreadSession.has(entry.id) || entry.id === this.bundle?.entry.id) &&
      (!query || `${titleOf(entry)} ${entry.title} ${entry.summary || ''} ${this.sourceName(entry)}`.toLocaleLowerCase().includes(query)));
  }
  private sourceName(entry: Entry) { return this.plugin.state.subscriptions.find(feed => feed.id === entry.sourceId)?.name || entry.sourceName || this.plugin.state.sources.find(source => source.id === entry.sourceId)?.name || entry.sourceId; }
  private excerpt(entry: Entry): string {
    if (entry.summaryZh) return entry.summaryZh;
    const text = entry.rewrite?.body.split('\n\n').find(line => /[\u3400-\u9fff]/.test(line) && !line.startsWith('#') && !line.startsWith('!['));
    return (text || entry.summary || '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#]/g, '').slice(0, 160);
  }
  private clearThumbnails() {
    this.thumbnailVersion++;
    for (const url of this.thumbnailUrls.values()) URL.revokeObjectURL(url);
    this.thumbnailUrls.clear(); this.thumbnailPending.clear();
  }
  private thumbnailUrl(url: string): Promise<string | null> {
    const cached = this.thumbnailUrls.get(url); if (cached) return Promise.resolve(cached);
    const pending = this.thumbnailPending.get(url); if (pending) return pending;
    const version = this.thumbnailVersion;
    const promise = this.plugin.images.load(url).then(blob => {
      if (this.closed || version !== this.thumbnailVersion) return null;
      const local = URL.createObjectURL(blob); this.thumbnailUrls.set(url, local); return local;
    }).catch(() => null);
    this.thumbnailPending.set(url, promise);
    void promise.finally(() => { if (this.thumbnailPending.get(url) === promise) this.thumbnailPending.delete(url); });
    return promise;
  }
  private renderThumbnail(row: HTMLElement, entry: Entry) {
    if (!this.plugin.state.settings.remoteImages) return;
    const url = entry.image ? safeUrl(entry.image, entry.link || undefined) : null; if (!url) return;
    const holder = row.createSpan('qrs-entry-thumb is-loading');
    const img = holder.createEl('img', { attr: { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });
    void this.thumbnailUrl(url).then(local => {
      if (!local || !holder.isConnected) { holder.remove(); return; }
      img.onload = () => holder.removeClass('is-loading'); img.onerror = () => holder.remove(); img.src = local;
    });
  }
  private renderList() {
    const restoreFocus = this.list.contains(this.contentEl.ownerDocument.activeElement);
    const scroll = this.list.scrollTop; this.list.empty(); const entries = this.visibleEntries();
    if (!entries.length) this.list.createDiv({ cls: 'qrs-empty', text: this.loading ? '正在获取文章…' : this.filter === 'favorites' ? '收藏喜欢的文章，在这里慢慢读。' : this.personalScope() && !this.entries.length ? '还没有文章。点击 + 添加订阅，或点击刷新获取文章。' : '暂无匹配文章，试试其他频道或筛选。' });
    for (const entry of entries) {
      const read = this.plugin.state.readIds.includes(entry.id);
      const row = this.list.createEl('button', { cls: 'qrs-entry', attr: { 'data-entry-id': entry.id } });
      row.toggleClass('qrs-selected', this.bundle?.entry.id === entry.id);
      row.setAttribute('aria-pressed', String(this.bundle?.entry.id === entry.id)); row.toggleClass('qrs-read', read);
      const copy = row.createSpan('qrs-entry-copy');
      const meta = copy.createSpan('qrs-entry-meta');
      meta.createSpan({ text: this.sourceName(entry), cls: 'qrs-source-name' });
      const date = entry.publishedTs ? new Date(entry.publishedTs) : entry.published ? new Date(entry.published) : null;
      meta.createSpan({ cls: 'qrs-date', text: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '' });
      const title = copy.createDiv('qrs-entry-title');
      title.createSpan({ cls: read ? 'qrs-read-dot' : 'qrs-unread-dot', attr: { 'aria-hidden': 'true' } });
      title.createSpan({ cls: 'qrs-visually-hidden', text: read ? '已读' : '未读' });
      title.createEl('h3', { text: titleOf(entry) });
      if (this.plugin.state.favorites[entry.id]) setIcon(title.createSpan('qrs-bookmarked'), 'bookmark');
      const summary = this.excerpt(entry); if (summary) copy.createEl('p', { text: summary, cls: 'qrs-summary' });
      this.renderThumbnail(row, entry);
      row.addEventListener('click', () => { void this.openArticle(entry); });
    }
    if (this.hasMore && this.filter !== 'favorites') {
      const button = this.list.createEl('button', { text: this.loading ? '加载中…' : '加载更早文章', cls: 'qrs-more' });
      button.disabled = this.loading; button.addEventListener('click', () => { void this.loadEntries(true); });
    }
    this.list.scrollTop = scroll;
    if (restoreFocus) this.reader.focus({ preventScroll: true });
  }
  private async openArticle(entry: Entry) {
    // Keep this unread reading session navigable after opening marks entries read.
    if (this.filter === 'unread') this.unreadSession.add(entry.id);
    const version = ++this.articleVersion; const state = this.plugin.state;
    this.bundle = state.cache[entry.id] || state.favorites[entry.id] || { entry, rewrite: entry.rewrite ?? null, translation: null, fetchedAt: 0 };
    state.readIds = [...new Set([...state.readIds, entry.id])].slice(-5000); this.run(() => this.plugin.persist());
    this.mode = entry.origin === 'local' || entry.origin === 'vault' ? 'original' : state.settings.defaultMode; this.message = ''; this.articleLoading = true; this.reader.setAttribute('aria-busy', 'true');
    this.contentEl.addClass('qrs-has-article'); this.renderReader(); this.reader.scrollTop = 0; this.reader.focus({ preventScroll: true }); this.renderList();
    if (entry.origin === 'local') {
      this.bundle = { entry, rewrite: null, translation: null, fetchedAt: Date.now() };
      this.plugin.remember(this.bundle); this.run(() => this.plugin.persist());
      this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false'); this.renderReader(); return;
    }
    try {
      const { bundle, warnings } = entry.origin === 'vault' ? { bundle: await this.plugin.vaultSources.article(entry), warnings: [] } : await this.plugin.api().article(entry.id);
      if (this.closed || version !== this.articleVersion) return;
      this.bundle = bundle; this.message = warnings.join('；'); this.plugin.remember(bundle); this.run(() => this.plugin.persist());
    } catch (error) {
      if (this.closed || version !== this.articleVersion) return;
      const cached = this.bundle.fetchedAt ? ` 正在显示 ${new Date(this.bundle.fetchedAt).toLocaleString()} 的缓存。` : ' 可重新打开文章重试。';
      this.message = `${error instanceof Error ? error.message : '获取正文失败。'}${cached}`;
    }
    if (!this.closed && version === this.articleVersion) { this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false'); this.renderReader(); this.renderList(); }
  }
  showSavedArticle(bundle: Bundle, mode: Mode) {
    this.articleVersion++; this.articleLoading = false;
    this.bundle = bundle; this.mode = mode; this.message = '';
    this.reader.setAttribute('aria-busy', 'false'); this.contentEl.addClass('qrs-has-article');
    this.renderReader(); this.reader.scrollTop = 0; this.reader.focus({ preventScroll: true }); this.renderList();
  }
  private noteCurrent() {
    const bundle = this.bundle; if (!bundle) return;
    this.run(async () => {
      this.plugin.remember(bundle);
      const result = await this.plugin.noteArticle(bundle.entry, '', this.mode);
      new Notice(result.added ? '已添加到今日日记。' : '今日日记中已有这篇文章。');
    });
  }
  private clearImages() {
    this.markdownComponent?.unload(); this.markdownComponent = undefined;
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
    this.selectionCapture?.clear();
    const active = this.contentEl.ownerDocument.activeElement;
    const restoreFocus = active !== this.reader && this.reader.contains(active);
    const scroll = this.reader.scrollTop;
    const previous = keepContent ? this.reader.querySelector('.qrs-article') : null;
    if (!previous) this.clearImages();
    this.reader.empty();
    // A removed toolbar button must not leave keyboard focus on document.body.
    if (restoreFocus) this.reader.focus({ preventScroll: true });
    const bundle = this.bundle;
    if (!bundle) {
      const empty = this.reader.createDiv('qrs-welcome'); setIcon(empty.createDiv('qrs-welcome-icon'), 'book-open');
      empty.createEl('h2', { text: '选一篇，开始读。' }); empty.createEl('p', { text: '上下篇：j / k · 收起列表：[ · 搜索：/' }); return;
    }
    const toolbar = this.reader.createDiv('qrs-reader-toolbar');
    this.addIconButton(toolbar, this.focused ? 'panel-left-open' : 'panel-left-close', '显示或收起文章列表 [', () => this.toggleFocus());
    const modeId = `${this.appearanceId}-mode`; toolbar.createEl('label', { cls: 'qrs-visually-hidden', text: '阅读版本', attr: { for: modeId } });
    const select = toolbar.createEl('select', { cls: 'qrs-mode-select', attr: { id: modeId, 'data-qrs-field': '阅读版本' } });
    for (const [mode, label] of Object.entries(modeLabels).filter(([mode]) => (bundle.entry.origin !== 'local' && bundle.entry.origin !== 'vault') || mode === 'original')) select.createEl('option', { value: mode, text: label });
    select.disabled = bundle.entry.origin === 'local' || bundle.entry.origin === 'vault';
    select.value = this.mode; select.onchange = () => { this.mode = modeSchema.parse(select.value); this.renderReader(); };
    const nav = toolbar.createDiv('qrs-reader-nav');
    this.addIconButton(nav, 'chevron-up', '上一篇 K', () => this.navigate(-1));
    this.addIconButton(nav, 'chevron-down', '下一篇 J', () => this.navigate(1));
    const actions = toolbar.createDiv('qrs-actions');
    const appearance = this.addIconButton(actions, 'type', '阅读设置', () => { this.appearanceOpen = !this.appearanceOpen; this.renderReader(true); });
    appearance.setAttribute('aria-expanded', String(this.appearanceOpen)); appearance.setAttribute('aria-controls', this.appearanceId);
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
    this.addIconButton(actions, 'notebook-pen', '记到今日日记', () => this.noteCurrent());
    const more = this.addIconButton(actions, 'ellipsis', '更多文章操作', () => {
      const menu = new Menu(); const link = safeUrl(bundle.entry.link || '');
      if (bundle.entry.origin === 'vault' && bundle.entry.markdownPath) menu.addItem(item => item.setTitle('打开源文件').setIcon('file-text').onClick(() => {
        void this.app.workspace.openLinkText(bundle.entry.markdownPath!, '', true);
      }));
      if (link) menu.addItem(item => item.setTitle('在浏览器打开原文').setIcon('external-link').onClick(() => { this.contentEl.win.open(link, '_blank', 'noopener,noreferrer'); }));
      menu.addItem(item => item.setTitle('重新加载文章').setIcon('refresh-cw').onClick(() => { void this.openArticle(bundle.entry); }));
      menu.addItem(item => item.setTitle('选择频道').setIcon('rss').onClick(() => this.pickChannel()));
      const rect = more.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
    });
    if (this.appearanceOpen) this.renderAppearanceSettings(toolbar);
    if (previous) { this.reader.append(previous); this.reader.scrollTop = scroll; return; }
    const article = this.reader.createEl('article', { cls: 'qrs-article' });
    const metadata = article.createDiv('qrs-article-meta');
    metadata.createSpan({ text: this.sourceName(bundle.entry) });
    const date = bundle.entry.publishedTs ? new Date(bundle.entry.publishedTs) : null;
    if (date) metadata.createSpan({ text: date.toLocaleDateString() });
    if (this.mode !== 'original') metadata.createSpan({ text: 'AI ' + (this.mode === 'rewrite' ? '改写' : '翻译'), cls: 'qrs-ai-label' });
    article.createEl('h1', { text: titleOf(bundle.entry) });
    if (this.message) article.createDiv({ cls: 'qrs-feedback', text: this.message, attr: { role: 'status' } });
    try {
      if (bundle.entry.origin === 'vault' && bundle.entry.markdown != null) {
        const prose = article.createDiv('qrs-prose');
        this.markdownComponent = new Component(); this.markdownComponent.load();
        void MarkdownRenderer.render(this.app, bundle.entry.markdown, prose, bundle.entry.markdownPath || '', this.markdownComponent)
          .catch(() => { prose.setText('Markdown 无法显示，请打开源文件。'); });
      } else {
      const fragment = articleFragment(bundle, this.mode, article.ownerDocument, this.plugin.state.settings.remoteImages);
      if (fragment) { this.prepareImages(fragment); article.createDiv('qrs-prose').append(fragment); }
      else article.createDiv({ cls: 'qrs-empty', text: this.articleLoading ? '正在获取正文…' : `${modeLabels[this.mode]}暂无正文。可以切换版本，或从“更多”中打开原文。` });
      }
    } catch { article.createDiv({ cls: 'qrs-empty', text: '正文无法显示，请打开原文阅读。' }); }
    this.reader.scrollTop = scroll;
  }
  private renderAppearanceSettings(anchor: HTMLElement) {
    const settings = this.plugin.state.settings;
    const headingId = `${this.appearanceId}-heading`;
    const panel = anchor.createEl('section', { cls: 'qrs-reading-settings', attr: { id: this.appearanceId, 'aria-labelledby': headingId } });
    const header = panel.createDiv('qrs-reading-settings-head'); header.createEl('strong', { text: '阅读设置', attr: { id: headingId } });
    const close = header.createEl('button', { text: '完成' }); close.onclick = () => { this.appearanceOpen = false; this.renderReader(true); };
    const fields = panel.createDiv('qrs-reading-settings-fields');
    const row = (label: string) => { const el = fields.createEl('label', { cls: 'qrs-reading-setting' }); el.createSpan({ text: label }); return el; };
    const fontRow = row('字体');
    const font = fontRow.createEl('select', { attr: { 'data-qrs-field': '正文字体' } });
    for (const choice of readingFonts) font.createEl('option', { value: choice.id, text: choice.name });
    font.value = settings.fontFamily;
    const sizeRow = row('字号'); const sizeValue = sizeRow.createEl('output', { text: `${settings.fontSize} px` });
    const size = sizeRow.createEl('input', { type: 'range', value: String(settings.fontSize), attr: { min: '14', max: '32', step: '1', 'data-qrs-field': '正文字号' } });
    const heightRow = row('行距'); const heightValue = heightRow.createEl('output', { text: `${settings.lineHeight.toFixed(1)} 倍` });
    const height = heightRow.createEl('input', { type: 'range', value: String(settings.lineHeight), attr: { min: '1.5', max: '2.4', step: '0.1', 'data-qrs-field': '正文行距' } });
    const widthRow = row('版心宽度');
    const width = widthRow.createEl('select', { attr: { 'data-qrs-field': '正文宽度' } });
    for (const [value, label] of [['28', '紧凑 · 28 字'], ['36', '适中 · 36 字'], ['44', '宽松 · 44 字']] as const) width.createEl('option', { value, text: label });
    width.value = String(settings.lineWidth);
    const update = () => { sizeValue.setText(`${settings.fontSize} px`); heightValue.setText(`${settings.lineHeight.toFixed(1)} 倍`); this.applyAppearance(); };
    font.onchange = () => { settings.fontFamily = readingFontSchema.parse(font.value); update(); this.run(() => this.plugin.persist()); };
    size.oninput = () => { settings.fontSize = Number(size.value); update(); }; size.onchange = () => this.run(() => this.plugin.persist());
    height.oninput = () => { settings.lineHeight = Number(height.value); update(); }; height.onchange = () => this.run(() => this.plugin.persist());
    width.onchange = () => { settings.lineWidth = Number(width.value) as 28 | 36 | 44; update(); this.run(() => this.plugin.persist()); };
    const reset = panel.createEl('button', { text: '恢复默认', cls: 'qrs-reading-reset' });
    reset.onclick = () => {
      settings.fontFamily = 'serif'; settings.fontSize = 19; settings.lineHeight = 1.9; settings.lineWidth = 36;
      font.value = settings.fontFamily; size.value = String(settings.fontSize); height.value = String(settings.lineHeight); width.value = String(settings.lineWidth);
      update(); this.run(() => this.plugin.persist());
    };
    panel.onkeydown = event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.appearanceOpen = false; this.renderReader(true); } };
  }
}
