import { addSearchClear } from './search-clear';
import { ChannelPicker, channelMark, type ChannelChoice } from './channel-picker';
import { Component, MarkdownRenderer, ItemView, Menu, Notice, Platform, setIcon, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { vaultSourceId } from './vault-source';
import { enableImageDrag, prepareMarkdownImageDrags } from './image-drag';
import { SelectionCapture } from './selection';
import { readingFonts, selectableFonts, fontFamily } from './fonts';
import { articleFragment } from './content';
import { saveArticleMarkdown, saveArticlePdf } from './desktop-export';
import { renderMedia, stopMedia, youtubeEmbedUrl } from './media';
import { sameRemoteContent, uniqueRemoteEntries, wechatArticleKey, xiaoyuzhouEpisodeKey } from './wechat-articles';
import { featuredXiaoyuzhouPodcasts, prependFeaturedPodcasts, qiaomuChannelDivider, qiaomuFeaturedEntries, readerChannelSources } from './discovery';
import { modeLabels, modeSchema, podcastDefaultMode, readingFontSchema, safeUrl, titleOf, type ChannelState, type Bundle, type Entry, type Mode } from './model';
export const VIEW_TYPE = 'qiaomu-ai-rss-reader';
type Filter = 'all' | 'unread' | 'favorites' | 'later';
function feedHost(url: string) { try { return new URL(url).hostname; } catch { return 'RSS'; } }
function podcastRelativeDateLabel(value: string | null | undefined): string {
  const raw = (value || '').trim();
  if (/^today$/i.test(raw)) return '今天';
  if (/^yesterday$/i.test(raw)) return '昨天';
  const match = /^(over|almost|about)?\s*(\d+)\s*(day|week|month|year)s? ago$/i.exec(raw);
  if (!match) return raw;
  const unit = { day: '天', week: '周', month: '个月', year: '年' }[match[3].toLowerCase() as 'day' | 'week' | 'month' | 'year'];
  const prefix = match[1]?.toLowerCase() === 'almost' ? '近 ' : match[1]?.toLowerCase() === 'about' ? '约 ' : '';
  return `${prefix}${match[2]} ${unit}${match[1]?.toLowerCase() === 'over' ? '多' : ''}前`;
}
export class ReaderView extends ItemView {
  private channelPicker?: ChannelPicker;
  private restoreObserver?: ResizeObserver;
  private pendingScroll?: { listTop: number; readerTop: number };
  private checkpointTimer?: number;
  private lastListTop = 0;
  private lastReaderTop = 0;
  private channelKey() { return JSON.stringify([this.plugin.state.settings.baseUrl, this.source]); }
  private saveChannel() {
    if (!this.list || !this.reader) return;
    // Strip heavy `content` from channelStates to avoid duplicating subscriptions[].entries[].content
    // (content is 95% of data.json). Content is re-hydrated from subscriptions on restore.
    const stripContent = (entry: Entry): Entry => entry.content ? { ...entry, content: undefined } : entry;
    this.plugin.state.channelStates[this.channelKey()] = {
      entries: this.entries.map(stripContent), bundle: this.bundle, mode: this.mode, filter: this.filter, query: this.query,
      unread: [...this.unreadSession], cursor: this.cursor, hasMore: this.hasMore,
      listTop: this.pendingScroll?.listTop ?? (this.list.clientHeight ? this.list.scrollTop : this.lastListTop),
      readerTop: this.pendingScroll?.readerTop ?? (this.reader.clientHeight ? this.reader.scrollTop : this.lastReaderTop), articlePending: this.articleLoading,
    };
  }
  private stopRestoring() { this.pendingScroll = undefined; this.restoreObserver?.disconnect(); }
  private restoreOffsets() {
    this.restoreObserver?.disconnect();
    if (!this.pendingScroll) return;
    const apply = () => { if (this.pendingScroll) {
      this.list.scrollTop = this.pendingScroll.listTop; this.reader.scrollTop = this.pendingScroll.readerTop;
    } };
    apply(); this.restoreObserver = new ResizeObserver(apply);
    const article = this.reader.querySelector('.qrs-article'); if (article) this.restoreObserver.observe(article);
    this.restoreObserver.observe(this.list); this.restoreObserver.observe(this.reader);
  }
  private restoreChannel(saved: ChannelState) {
    // Re-hydrate stripped `content` from subscriptions (the single source of truth)
    const byId = new Map<string, Entry>();
    for (const feed of this.plugin.state.subscriptions) for (const e of feed.entries) byId.set(e.id, e);
    // Also consider cached/favorite bundles as fallback
    for (const b of Object.values(this.plugin.state.cache)) byId.set(b.entry.id, b.entry);
    for (const b of Object.values(this.plugin.state.favorites)) byId.set(b.entry.id, b.entry);
    for (const b of Object.values(this.plugin.state.savedArticles)) byId.set(b.entry.id, b.entry);
    const hydrate = (e: Entry): Entry => {
      if (e.content) return e;
      const found = byId.get(e.id);
      return found?.content ? { ...e, content: found.content, summary: e.summary ?? found.summary } : e;
    };
    const entries = saved.entries.map(hydrate);
    let bundle = saved.bundle;
    if (bundle && !bundle.entry.content) {
      const found = byId.get(bundle.entry.id);
      if (found?.content) bundle = { ...bundle, entry: { ...bundle.entry, content: found.content } };
    }
    this.entries = this.source ? entries : qiaomuFeaturedEntries(entries);
    this.bundle = !this.source && bundle && !qiaomuFeaturedEntries([bundle.entry]).length ? null : bundle;
    this.mode = saved.mode;
    if (this.bundle) {
      const idx = this.visibleEntries().findIndex(e => e.id === this.bundle?.entry.id);
      if (idx >= 0) this.renderedCount = Math.min(this.visibleEntries().length, Math.max(ReaderView.PAGE_SIZE, idx + ReaderView.PAGE_SIZE));
    }
    this.filter = saved.filter; this.query = saved.query; this.unreadSession = new Set(saved.unread);
    this.cursor = saved.cursor; this.hasMore = saved.hasMore; this.lastListTop = saved.listTop; this.lastReaderTop = saved.readerTop;
    this.pendingScroll = { listTop: saved.listTop, readerTop: saved.readerTop };
    this.searchInput.value = this.query; this.searchBox.toggleClass('is-hidden', !this.query);
    this.contentEl.toggleClass('qrs-has-article', !!this.bundle);
    this.renderFilters(); this.renderList(); this.renderReader(); this.restoreOffsets();
    if (saved.articlePending && this.bundle) void this.openArticle(this.bundle.entry, saved);
  }
  private markdownComponent?: Component;
  private selectionCapture?: SelectionCapture;
  private list!: HTMLElement;
  private reader!: HTMLElement;
  private status!: HTMLElement;
  private channelButton!: HTMLButtonElement;
  private searchBox!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private welcomeSource?: string;
  private welcomeTip = -1;
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
  // Windowed list rendering: only first `renderedCount` rows exist in DOM.
  private renderedCount = 60;
  private static readonly PAGE_SIZE = 60;
  private static readonly THUMB_CAP = 60;
  private listSentinelObserver?: IntersectionObserver;
  private renderScheduled = false;
  constructor(leaf: WorkspaceLeaf, private plugin: QiaomuRssPlugin) {
    super(leaf); this.mode = plugin.state.settings.defaultMode;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Qiaomu AI RSS'; }
  getIcon() { return 'rss'; }
  onOpen(): Promise<void> {
    this.reset();
    this.registerDomEvent(this.contentEl.ownerDocument, 'pointerdown', event => {
      const target = event.target as HTMLElement;
      if (!this.appearanceOpen || target.closest?.('.qrs-reading-settings') || target.closest?.('[data-qrs-label="阅读设置"]')) return;
      this.appearanceOpen = false; this.reader.querySelector('.qrs-reading-settings')?.remove();
      this.reader.querySelector('[aria-controls="' + this.appearanceId + '"]')?.setAttribute('aria-expanded', 'false');
      this.run(() => this.plugin.persist());
    });
    this.registerDomEvent(this.contentEl, 'contextmenu', event => {
      // Let mobile WebViews open their native text-selection handles.
      if (Platform.isMobileApp || ('pointerType' in event && event.pointerType === 'touch')) return;
      const target = event.target;
      if (!(target instanceof this.contentEl.ownerDocument.defaultView!.HTMLElement) || !target.closest('.qrs-article') || !this.bundle) return;
      event.preventDefault();
      const bundle = this.bundle, mode = this.mode, note = this.plugin.currentNote();
      const selection = this.contentEl.ownerDocument.getSelection();
      const prose = target.closest('.qrs-article')?.querySelector('.qrs-prose');
      const excerpt = selection && prose?.contains(selection.anchorNode) && prose.contains(selection.focusNode) ? selection.toString().trim() : '';
      const append = async (current: boolean) => {
        try {
          this.plugin.remember(bundle);
          const result = await this.plugin.appendToDailyNote(bundle.entry, excerpt, mode, current && note ? note : undefined);
          new Notice(result.added ? `已追加到 ${result.file.basename}` : '这篇文章或摘录已在笔记中。');
        } catch (error) { new Notice(error instanceof Error ? error.message : '无法追加到笔记。'); }
      };
      new Menu().setUseNativeMenu(false)
        .addItem(item => item.setTitle(note ? `追加到当前笔记：${note.basename}` : '追加到当前笔记（请先打开笔记）').setIcon('file-pen-line').setDisabled(!note).onClick(() => append(true)))
        .addItem(item => item.setTitle('追加到今日日记').setIcon('calendar-days').onClick(() => append(false)))
        .showAtMouseEvent(event);
    });
    this.selectionCapture = new SelectionCapture(this.contentEl.ownerDocument, () => this.reader, () => {
      const bundle = this.bundle, mode = this.mode;
      if (!bundle || !this.plugin.state.settings.selectionPopup) return null;
      const note = this.plugin.currentNote();
      const capture = async (text: string, current: boolean) => {
        try {
          this.plugin.remember(bundle);
          const result = current && note
            ? await this.plugin.appendToDailyNote(bundle.entry, text, mode, note)
            : await this.plugin.noteArticle(bundle.entry, text, mode);
          new Notice(result.added ? `摘录已添加到 ${result.file.basename}` : '这段摘录已在笔记中。');
        } catch (error) { new Notice(error instanceof Error ? error.message : '摘录失败，请重试。'); }
      };
      return [
        { label: '追加到今日日记', icon: 'calendar-plus', save: text => capture(text, false) },
        { label: note ? `追加到当前笔记：${note.basename}` : '追加到当前笔记（请先打开笔记）', icon: 'file-pen-line', disabled: !note, save: text => capture(text, true) },
      ];
    });
    return Promise.resolve();
  }
  onClose(): Promise<void> {
    stopMedia(this.reader);
    this.saveChannel(); this.channelPicker?.close(false); this.stopRestoring(); this.listSentinelObserver?.disconnect(); this.listSentinelObserver = undefined;
    if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
    this.selectionCapture?.dispose();
    this.closed = true; this.listVersion++; this.articleVersion++; this.clearImages(); this.clearThumbnails(); this.contentEl.onkeydown = null;
    return this.plugin.persist().catch(() => undefined);
  }
  reset() {
    if (this.reader) stopMedia(this.reader);
    this.channelPicker?.close(false); this.stopRestoring();
    if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
    this.unreadSession.clear();
    this.closed = false; this.listVersion++; this.articleVersion++; this.clearThumbnails();
    const remembered = this.plugin.state.settings.lastSource;
    const localExists = this.plugin.state.subscriptions.some(feed => feed.id === remembered);
    const groupExists = remembered.startsWith('@group:') && this.plugin.state.subscriptions.some(feed => feed.group === remembered.slice(7));
    this.resetWindow();
    this.focused = false; this.source = remembered !== 'levelingup' && (remembered === '@local' || this.plugin.state.settings.markdownFolders.some(folder => vaultSourceId(folder) === remembered) || groupExists || localExists || this.plugin.state.settings.followedPodcasts.includes(remembered) || readerChannelSources(this.plugin.state.sources).some(source => source.id === remembered)) ? remembered : '';
    this.cursor = ''; this.bundle = null; this.loading = false; this.hasMore = false;
    this.mode = this.plugin.state.settings.defaultMode;
    this.entries = this.personalScope() ? this.localEntries() : this.source ? [] : qiaomuFeaturedEntries(this.plugin.state.entries);
    this.build();
    const saved = this.plugin.state.channelStates[this.channelKey()];
    if (saved) { this.restoreChannel(saved); if (!this.entries.length || !this.source) void this.loadEntries(); }
    else { this.renderList(); this.renderReader(); void this.loadEntries(); }
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
    this.contentEl.setCssProps({ '--qrs-font-family': fontFamily(settings.fontFamily, settings.customFont) });
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
    addSearchClear(this.searchInput);
    this.searchInput.value = this.query;
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value; this.unreadSession.clear(); this.resetWindow(); this.renderList(); });
    this.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.toggleSearch(false); } });
    this.status = sidebar.createDiv({ cls: 'qrs-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.list = sidebar.createDiv({ cls: 'qrs-list' });
    this.createResizeHandle(body);
    this.reader = body.createEl('section', { cls: 'qrs-reader', attr: { tabindex: '0' } });
    root.onkeydown = event => this.onReaderKey(event);
    for (const element of [this.list, this.reader]) {
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) element.addEventListener(event, () => this.stopRestoring(), { passive: true });
      element.addEventListener('scroll', () => {
        if (this.list.clientHeight) this.lastListTop = this.list.scrollTop;
        if (this.reader.clientHeight) this.lastReaderTop = this.reader.scrollTop;
        if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
        this.checkpointTimer = window.setTimeout(() => { this.saveChannel(); this.run(() => this.plugin.persist()); }, 700);
      });
    }
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
    const laterCount = this.plugin.state.readLater.length;
    for (const [value, label] of [['all', '全部'], ['unread', '未读'], ['favorites', '收藏'], ['later', laterCount ? `稍后读（${laterCount}）` : '稍后读']] as const) {
      const button = this.filters.createEl('button', { text: label, attr: { 'aria-pressed': String(value === this.filter), 'data-filter': value } });
      button.addEventListener('click', () => { this.filter = value; this.unreadSession.clear(); this.resetWindow(); this.renderFilters(); this.renderList(); });
    }
    this.addIconButton(this.filters, 'settings', '插件设置', () => this.plugin.openSettings()).addClass('qrs-settings-button');
  }
  private channelChoices(): ChannelChoice[] {
    const feeds = this.plugin.state.subscriptions;
    const groups = [...new Set(feeds.map(feed => feed.group).filter(Boolean))].sort();
    return [
      { id: '', name: '乔木精选', section: '聚合', subtitle: '乔木筛选的高质量内容', icon: 'tree-deciduous' },
      { id: '@local', name: '我的订阅', section: '聚合', subtitle: `${feeds.length} 个个人订阅源`, icon: 'rss' },
      ...this.plugin.state.settings.markdownFolders.map(folder => ({ id: vaultSourceId(folder), name: folder === '/' ? '整个库' : folder.split('/').at(-1)!, section: '库内文件夹' as const, subtitle: folder, icon: folder.endsWith('.md') ? 'file-text' : 'folder-open' })),
      ...groups.map(group => ({ id: `@group:${group}`, name: group, section: '订阅分组' as const,
        subtitle: `${feeds.filter(feed => feed.group === group).length} 个订阅源`, icon: 'folder' })),
      ...readerChannelSources(this.plugin.state.sources).map(source => ({ id: source.id, name: source.name, section: '乔木频道' as const,
        subtitle: ({ article: '文章', news: '新闻', podcast: '播客' } as Record<string, string>)[source.category || ''] || source.category || '乔木内容频道', monogram: source.name.trim().slice(0, 1), divider: qiaomuChannelDivider(source) })),
      ...this.plugin.state.settings.followedPodcasts.filter(id => !featuredXiaoyuzhouPodcasts(this.plugin.state.sources).some(source => source.id === id)).map(id => {
        const source = this.plugin.state.sources.find(item => item.id === id && item.enabled !== false);
        return { id, name: this.plugin.state.settings.podcastNames[id] || source?.name || id.replace(/^podscribe-/, ''), section: '已订阅播客' as const,
          subtitle: id.startsWith('podscribe-') ? '海外播客 · 源文稿' : '播客', icon: 'mic' };
      }),
      ...feeds.map(feed => ({ id: feed.id, name: feed.name, section: '我的订阅源' as const,
        subtitle: `${feed.group ? `${feed.group} · ` : ''}${feedHost(feed.url)} · ${feed.entries.length} 篇`, monogram: feed.name.trim().slice(0, 1), group: feed.group })),
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
  showRemoteSource(id: string) { if (id !== 'levelingup') this.selectSource(id); }
  private pickChannel() {
    if (this.channelPicker) { this.channelPicker.close(); return; }
    this.channelPicker = new ChannelPicker(this.channelButton, this.channelChoices(), this.source, source => this.selectSource(source.id), () => { this.channelPicker = undefined; });
    this.channelPicker.load();
  }
  private selectSource(source: string, refresh = true) {
    if (source === this.source) { if (!refresh) void this.loadEntries(); return; }
    this.saveChannel(); this.stopRestoring();
    this.unreadSession.clear();
    this.listVersion++; this.loading = false; this.refreshButton.removeClass('is-loading');
    this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false');
    this.source = source; this.cursor = ''; this.entries = []; this.hasMore = false;
    this.plugin.state.settings.lastSource = source; this.run(() => this.plugin.persist());
    this.bundle = null; this.articleVersion++; this.focused = false; this.contentEl.removeClass('qrs-focus');
    this.contentEl.removeClass('qrs-focus'); this.contentEl.removeClass('qrs-has-article');
    this.entries = this.personalScope() ? this.localEntries() : source ? [] : qiaomuFeaturedEntries(this.plugin.state.entries);
    this.resetWindow();
    this.status.setText(''); this.renderChannel();
    const saved = this.plugin.state.channelStates[this.channelKey()];
    if (saved) { this.restoreChannel(saved); if (!this.entries.length && refresh) void this.loadEntries(); return; }
    this.filter = 'all'; this.query = ''; this.searchInput.value = ''; this.searchBox.addClass('is-hidden'); this.lastListTop = 0; this.lastReaderTop = 0;
    this.renderFilters(); this.renderReader(); this.renderList(); this.list.scrollTop = 0; this.reader.scrollTop = 0;
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
    if (event.key === '[') { event.preventDefault(); this.toggleFocus(); }
    if (key === 'f' && this.bundle) { event.preventDefault(); event.stopPropagation(); this.toggleFavorite(); }
    if (key === 'u' && this.bundle) { event.preventDefault(); event.stopPropagation(); this.toggleUnread(); }
    if (key === 'o' && this.bundle) { event.preventDefault(); event.stopPropagation(); this.openOriginal(); }
    if (key === 'e' && this.bundle) { event.preventDefault(); event.stopPropagation(); this.noteCurrent(); }
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
        if (feeds.length) this.status.setText(`正在同步 0/${feeds.length}…`);
        const summary = await this.plugin.subscriptions.refresh(feeds.map(feed => feed.id), this.reader.ownerDocument, force, (done, total) => {
          if (!this.closed && version === this.listVersion) {
            this.status.setText(`正在同步 ${done}/${total}…`);
            this.entries = this.localEntries(); this.scheduleRenderList();
          }
        });
        if (this.closed || version !== this.listVersion) return;
        this.entries = this.localEntries(); this.hasMore = false;
        const parts: string[] = [];
        if (summary.changed) parts.push(`${summary.changed} 个源有更新`);
        if (summary.failed) parts.push(`${summary.failed} 个订阅刷新失败，保留已有文章`);
        if (summary.skipped) parts.push(`${summary.skipped} 个跳过（未到期/已暂停/退避中）`);
        this.status.setText(parts.length ? `${parts.join('，')}。${summary.failed ? '可在订阅管理中查看详情。' : ''}` : '');
        return;
      }
      const api = this.plugin.api();
      if (this.source.startsWith('podscribe-') && !state.sources.some(source => source.id === this.source && source.enabled !== false)) {
        const page = await api.podcastEpisodes(this.source, more ? this.cursor : '');
        if (this.closed || version !== this.listVersion) return;
        this.entries = more ? [...new Map([...this.entries, ...page.entries].map(entry => [entry.id, entry])).values()] : page.entries;
        this.cursor = page.nextCursor || ''; this.hasMore = page.hasMore && !!this.cursor;
        return;
      }
      const [page, sources] = await Promise.allSettled([api.entries(this.source, more ? this.cursor : ''), api.sources()]);
      if (this.closed || version !== this.listVersion) return;
      if (sources.status === 'fulfilled') { state.sources = sources.value.sources; this.renderChannel(); }
      if (page.status === 'rejected') throw page.reason;
      const pageEntries = this.source ? page.value.entries : qiaomuFeaturedEntries(page.value.entries);
      this.entries = more ? [...new Map([...this.entries, ...pageEntries].map(entry => [entry.id, entry])).values()] : pageEntries;
      this.cursor = page.value.nextCursor || ''; this.hasMore = !!page.value.hasMore && !!this.cursor;
      if (!this.source && !more) {
        this.renderList();
        const featured = featuredXiaoyuzhouPodcasts(state.sources);
        const latest = await Promise.allSettled(featured.map(source => api.entries(source.id, '', 1)));
        if (this.closed || version !== this.listVersion) return;
        this.entries = prependFeaturedPodcasts(this.entries, latest.flatMap(result => result.status === 'fulfilled' ? result.value.entries : []));
      }
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
    if (this.filter === 'later') {
      const order = new Map(state.readLater.map((id, i) => [id, i] as const));
      return entries.filter(e => order.has(e.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    const query = this.query.trim().toLocaleLowerCase();
    return uniqueRemoteEntries(entries, this.bundle?.entry.id).filter(entry => (this.vaultScope() ? entry.origin === 'vault' && entry.sourceId === this.source : this.personalScope()
      ? entry.origin === 'local' && (this.source === '@local' || this.selectedFeeds().some(feed => feed.id === entry.sourceId))
      : entry.origin !== 'local' && entry.origin !== 'vault' && (!this.source || entry.sourceId === this.source)) &&
      entry.sourceId !== 'levelingup' &&
      (this.filter !== 'unread' || !this.relatedContentIds(entry).some(id => state.readIds.includes(id)) || this.unreadSession.has(entry.id) || entry.id === this.bundle?.entry.id) &&
      (!query || `${titleOf(entry)} ${entry.title} ${entry.summary || ''} ${this.sourceName(entry)}`.toLocaleLowerCase().includes(query)));
  }
  private relatedContentIds(entry: Entry): string[] {
    if (!wechatArticleKey(entry.link) && !xiaoyuzhouEpisodeKey(entry.link)) return [entry.id];
    return [...new Set([entry, ...this.entries, ...Object.values(this.plugin.state.favorites).map(bundle => bundle.entry)]
      .filter(candidate => sameRemoteContent(entry, candidate)).map(candidate => candidate.id))];
  }
  private sourceName(entry: Entry) { return this.plugin.state.subscriptions.find(feed => feed.id === entry.sourceId)?.name || entry.sourceName || this.plugin.state.settings.podcastNames[entry.sourceId] || this.plugin.state.sources.find(source => source.id === entry.sourceId)?.name || entry.sourceId; }
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
  private cacheThumbnail(url: string, local: string) {
    // LRU cap: evict oldest so 2000+ rows can never pin 2000+ blobs in memory.
    if (!this.thumbnailUrls.has(url) && this.thumbnailUrls.size >= ReaderView.THUMB_CAP) {
      const first = this.thumbnailUrls.keys().next();
      if (!first.done) { const u = this.thumbnailUrls.get(first.value); if (u) URL.revokeObjectURL(u); this.thumbnailUrls.delete(first.value); }
    }
    // Re-insert to refresh LRU order.
    if (this.thumbnailUrls.has(url)) this.thumbnailUrls.delete(url);
    this.thumbnailUrls.set(url, local);
  }
  private scheduleRenderList() {
    if (this.renderScheduled || this.closed) return;
    this.renderScheduled = true;
    window.requestAnimationFrame(() => { this.renderScheduled = false; if (!this.closed) this.renderList(); });
  }
  private resetWindow() { this.renderedCount = ReaderView.PAGE_SIZE; this.listSentinelObserver?.disconnect(); this.listSentinelObserver = undefined; }
  private thumbnailUrl(url: string): Promise<string | null> {
    const cached = this.thumbnailUrls.get(url); if (cached) return Promise.resolve(cached);
    const pending = this.thumbnailPending.get(url); if (pending) return pending;
    const version = this.thumbnailVersion;
    const promise = this.plugin.images.load(url).then(blob => {
      if (this.closed || version !== this.thumbnailVersion) return null;
      const local = URL.createObjectURL(blob); this.cacheThumbnail(url, local); return local;
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
    const scroll = this.list.scrollTop; this.list.empty(); this.listSentinelObserver?.disconnect(); this.listSentinelObserver = undefined;
    const entries = this.visibleEntries();
    if (!entries.length) this.list.createDiv({ cls: 'qrs-empty', text: this.loading ? '正在获取文章…' : this.filter === 'favorites' ? '收藏喜欢的文章，在这里慢慢读。' : this.personalScope() && !this.entries.length ? '还没有文章。点击 + 添加订阅，或点击刷新获取文章。' : '暂无匹配文章，试试其他频道或筛选。' });
    // Windowed rendering: only the first `renderedCount` rows enter the DOM.
    const shown = entries.slice(0, this.renderedCount);
    for (const entry of shown) {
      const relatedIds = this.relatedContentIds(entry);
      const read = relatedIds.some(id => this.plugin.state.readIds.includes(id));
      const row = this.list.createEl('button', { cls: 'qrs-entry', attr: { 'data-entry-id': entry.id } });
      row.toggleClass('qrs-selected', this.bundle?.entry.id === entry.id);
      row.setAttribute('aria-pressed', String(this.bundle?.entry.id === entry.id)); row.toggleClass('qrs-read', read);
      const copy = row.createSpan('qrs-entry-copy');
      const meta = copy.createSpan('qrs-entry-meta');
      meta.createSpan({ text: this.sourceName(entry), cls: 'qrs-source-name' });
      const date = entry.publishedTs ? new Date(entry.publishedTs) : entry.published ? new Date(entry.published) : null;
      meta.createSpan({ cls: 'qrs-date', text: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : podcastRelativeDateLabel(entry.publishedRelative) });
      if (entry.sourceId.startsWith('podscribe-')) {
        const details = [entry.podcastViews != null ? `原站浏览 ${entry.podcastViews.toLocaleString()}` : '',
          entry.podcastDurationSeconds ? `${Math.round(entry.podcastDurationSeconds / 60)} 分钟` : ''].filter(Boolean).join(' · ');
        if (details) meta.createSpan({ cls: 'qrs-podcast-facts', text: details });
      }
      const title = copy.createDiv('qrs-entry-title');
      title.createSpan({ cls: read ? 'qrs-read-dot' : 'qrs-unread-dot', attr: { 'aria-hidden': 'true' } });
      title.createSpan({ cls: 'qrs-visually-hidden', text: read ? '已读' : '未读' });
      const bilingual = (entry.sourceId === 'podscribe-all-in-with-chamath-jason-sacks-friedberg' || entry.sourceId === 'podscribe-the-joe-rogan-experience') &&
        !!entry.titleZh?.trim() && entry.titleZh.trim() !== entry.title.trim();
      const heading = bilingual ? title.createDiv('qrs-bilingual-heading') : title;
      heading.createEl('h3', { text: titleOf(entry) });
      if (bilingual) heading.createDiv({ cls: 'qrs-original-title', text: entry.title });
      if (relatedIds.some(id => this.plugin.state.favorites[id])) setIcon(title.createSpan('qrs-bookmarked'), 'bookmark');
      const summary = this.excerpt(entry); if (summary) copy.createEl('p', { text: summary, cls: 'qrs-summary' });
      this.renderThumbnail(row, entry);
      row.addEventListener('click', () => { void this.openArticle(entry); });
    }
    if (this.hasMore && this.filter !== 'favorites') {
      const button = this.list.createEl('button', { text: this.loading ? '加载中…' : '加载更早文章', cls: 'qrs-more' });
      button.disabled = this.loading; button.addEventListener('click', () => { void this.loadEntries(true); });
    }
    if (shown.length < entries.length) {
      const remaining = entries.length - shown.length;
      const sentinel = this.list.createDiv({ cls: 'qrs-more', text: this.loading ? '加载中…' : `显示更多（剩余 ${remaining} 篇）` });
      sentinel.setAttribute('role', 'button'); sentinel.setAttribute('tabindex', '0');
      const more = () => { this.renderedCount += ReaderView.PAGE_SIZE; this.renderList(); };
      sentinel.addEventListener('click', more);
      sentinel.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); more(); } });
      // Auto-extend when the sentinel scrolls into view (infinite scroll with a cap per step).
      this.listSentinelObserver = new IntersectionObserver(items => {
        for (const item of items) if (item.isIntersecting) { this.listSentinelObserver?.disconnect(); this.listSentinelObserver = undefined; more(); break; }
      }, { root: this.list, rootMargin: '800px' });
      this.listSentinelObserver.observe(sentinel);
    }
    this.list.scrollTop = scroll;
    if (restoreFocus) this.reader.focus({ preventScroll: true });
  }
  private async openArticle(entry: Entry, resume?: ChannelState) {
    this.stopRestoring();
    // Reading from the queue consumes the item.
    if (this.filter === 'later') this.plugin.state.readLater = this.plugin.state.readLater.filter(id => id !== entry.id);
    // Ensure the opened row exists in the windowed list.
    { const idx = this.visibleEntries().findIndex(e => e.id === entry.id);
      if (idx >= this.renderedCount) this.renderedCount = Math.min(this.visibleEntries().length, idx + ReaderView.PAGE_SIZE); }
    // Keep this unread reading session navigable after opening marks entries read.
    if (this.filter === 'unread') this.unreadSession.add(entry.id);
    const version = ++this.articleVersion; const state = this.plugin.state;
    this.bundle = state.cache[entry.id] || state.favorites[entry.id] || { entry, rewrite: entry.rewrite ?? null, translation: null, fetchedAt: 0 };
    state.readIds = [...new Set([...state.readIds, entry.id])].slice(-5000);
    state.readAt[entry.id] = Date.now();
    if (Object.keys(state.readAt).length > 6000) { const keep = new Set(state.readIds); for (const k of Object.keys(state.readAt)) if (!keep.has(k)) delete state.readAt[k]; }
    this.run(() => this.plugin.persist());
    this.mode = entry.origin === 'local' || entry.origin === 'vault' ? 'original'
      : podcastDefaultMode(entry, state.sources, state.settings.followedPodcasts)
        ?? (entry.audio || youtubeEmbedUrl(entry.videoUrl || entry.link) ? 'original' : state.settings.defaultMode);
    this.message = ''; this.articleLoading = true; this.reader.setAttribute('aria-busy', 'true');
    this.contentEl.addClass('qrs-has-article'); this.renderReader(); this.reader.scrollTop = 0; this.lastReaderTop = 0; this.reader.focus({ preventScroll: true }); this.renderList();
    if (resume) { this.mode = resume.mode; this.pendingScroll = { listTop: resume.listTop, readerTop: resume.readerTop }; this.renderReader(); this.restoreOffsets(); }
    if (entry.origin === 'local') {
      this.bundle = { entry, rewrite: null, translation: null, fetchedAt: Date.now() };
      this.plugin.remember(this.bundle); this.run(() => this.plugin.persist());
      this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false'); this.renderReader(); return;
    }
    try {
      const { bundle, warnings } = entry.origin === 'vault' ? { bundle: await this.plugin.vaultSources.article(entry), warnings: [] } : await this.plugin.api().article(entry.id, entry);
      if (this.closed || version !== this.articleVersion) return;
      this.bundle = bundle; this.message = warnings.join('；');
      this.plugin.remember(bundle); this.run(() => this.plugin.persist());
    } catch (error) {
      if (this.closed || version !== this.articleVersion) return;
      const cached = this.bundle.fetchedAt ? ` 正在显示 ${new Date(this.bundle.fetchedAt).toLocaleString()} 的缓存。` : ' 可重新打开文章重试。';
      this.message = `${error instanceof Error ? error.message : '获取正文失败。'}${cached}`;
    }
    if (!this.closed && version === this.articleVersion) {
      if (this.mode === 'rewrite' && !this.bundle.rewrite?.body.trim()) this.mode = 'original';
      this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false'); this.renderReader(); this.renderList();
    }
  }
  showSavedArticle(bundle: Bundle, mode: Mode) {
    this.stopRestoring();
    this.articleVersion++; this.articleLoading = false;
    this.bundle = bundle; this.mode = mode; this.message = '';
    this.reader.setAttribute('aria-busy', 'false'); this.contentEl.addClass('qrs-has-article');
    this.renderReader(); this.reader.scrollTop = 0; this.lastReaderTop = 0; this.reader.focus({ preventScroll: true }); this.renderList();
  }
  private toggleFavorite() {
    const bundle = this.bundle; if (!bundle) return;
    this.run(async () => {
      const ids = this.relatedContentIds(bundle.entry);
      const favoriteId = ids.find(id => this.plugin.state.favorites[id]);
      if (favoriteId) for (const id of ids) delete this.plugin.state.favorites[id];
      else this.plugin.state.favorites[bundle.entry.id] = bundle;
      await this.plugin.persist(); this.renderReader(true); this.renderList();
    });
  }
  private toggleUnread() {
    const bundle = this.bundle; if (!bundle) return;
    this.run(async () => {
      const relatedIds = this.relatedContentIds(bundle.entry);
      const read = relatedIds.some(id => this.plugin.state.readIds.includes(id));
      const ids = this.plugin.state.readIds.filter(id => !relatedIds.includes(id));
      this.plugin.state.readIds = read ? ids : [...ids, bundle.entry.id].slice(-5000);
      await this.plugin.persist(); this.renderReader(true); this.renderList();
    });
  }
  private openOriginal() {
    const bundle = this.bundle; if (!bundle) return;
    const link = safeUrl(bundle.entry.link || '');
    if (link) this.contentEl.win.open(link, '_blank', 'noopener,noreferrer');
    else new Notice('这篇文章没有原文链接。');
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
        enableImageDrag(img, blob);
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
    if (!previous) { stopMedia(this.reader); this.clearImages(); }
    this.reader.empty();
    // A removed toolbar button must not leave keyboard focus on document.body.
    if (restoreFocus) this.reader.focus({ preventScroll: true });
    const bundle = this.bundle;
    if (!bundle) {
      const empty = this.reader.createDiv('qrs-welcome');
      empty.createDiv({ cls: 'qrs-welcome-brand', text: 'QIAOMU RSS' });
      empty.createEl('h2', { text: '给阅读，留一点时间。' });
      empty.createEl('p', { cls: 'qrs-welcome-intro', text: '从列表中，挑一篇感兴趣的文章。' });
      const tips = [
        ['边读边记', '点击文章右上角的笔记本，在旁边打开今日日记。阅读和思考可以同时进行。'],
        ['留下有用的一段', '选中文字后，可追加到今日日记或当前笔记。也可以从右键菜单操作。'],
        ['把剪藏变成阅读', '在“来源”中添加库内文件夹，把剪藏的 Markdown 文章放进阅读器。'],
        ['找到舒服的排版', '正文右上角的字体按钮可以调整字号、行距和版心，改动立即保存。'],
        ['随时接着读', '切换频道后再回来，会恢复当前文章、列表位置和正文进度。'],
      ];
      if (this.welcomeSource !== this.source || this.welcomeTip < 0) { this.welcomeTip = (this.welcomeTip + 1) % tips.length; this.welcomeSource = this.source; }
      const tip = empty.createDiv('qrs-welcome-tip');
      const showTip = () => { tip.empty(); const [title, copy] = tips[this.welcomeTip]; tip.createDiv({ cls: 'qrs-welcome-index', text: `${String(this.welcomeTip + 1).padStart(2, '0')} / ${String(tips.length).padStart(2, '0')}   阅读小记` }); tip.createEl('h3', { text: title }); tip.createEl('p', { text: copy }); };
      showTip();
      empty.createEl('button', { cls: 'qrs-welcome-next', text: '下一则 →' }).onclick = () => { this.welcomeTip = (this.welcomeTip + 1) % tips.length; showTip(); };
      if (!Platform.isMobileApp) {
        const keys = empty.createDiv('qrs-welcome-keys');
        for (const [key, label] of [['J / K', '下篇 / 上篇'], ['[', '收起列表'], ['/', '搜索文章'], ['M', '稍后读'], ['F', '收藏'], ['E', '记日记'], ['O', '原文'], ['U', '已读']]) { const item = keys.createSpan(); item.createEl('kbd', { text: key }); item.createSpan({ text: label }); }
      }
      return;
    }
    const toolbar = this.reader.createDiv('qrs-reader-toolbar');
    this.addIconButton(toolbar, this.focused ? 'panel-left-open' : 'panel-left-close', '显示或收起文章列表 [', () => this.toggleFocus());
    const modeId = `${this.appearanceId}-mode`; toolbar.createEl('label', { cls: 'qrs-visually-hidden', text: '阅读版本', attr: { for: modeId } });
    const select = toolbar.createEl('select', { cls: 'qrs-mode-select', attr: { id: modeId, 'data-qrs-field': '阅读版本' } });
    const podcast = !!bundle.entry.podcastSlug || this.plugin.state.sources.some(source => source.id === bundle.entry.sourceId && source.category === 'podcast');
    const fullTranscript = !!bundle.entry.podcastSlug || ['allin', 'joerogan'].includes(bundle.entry.sourceId) || bundle.entry.sourceId.startsWith('podscribe-');
    for (const [mode, label] of Object.entries(modeLabels).filter(([mode]) => (bundle.entry.origin !== 'local' && bundle.entry.origin !== 'vault' && !bundle.entry.podcastSlug) || mode === 'original')) select.createEl('option', { value: mode, text: podcast ? mode === 'original' ? fullTranscript ? '源文稿' : '节目原文' : mode === 'rewrite' ? '乔木改写' : label : label });
    select.disabled = bundle.entry.origin === 'local' || bundle.entry.origin === 'vault' || !!bundle.entry.podcastSlug;
    select.value = this.mode; select.onchange = () => { this.mode = modeSchema.parse(select.value); this.renderReader(); };
    const nav = toolbar.createDiv('qrs-reader-nav');
    this.addIconButton(nav, 'chevron-up', '上一篇 K', () => this.navigate(-1));
    this.addIconButton(nav, 'chevron-down', '下一篇 J', () => this.navigate(1));
    const actions = toolbar.createDiv('qrs-actions');
    const appearance = this.addIconButton(actions, 'type', '阅读设置', () => { this.appearanceOpen = !this.appearanceOpen; this.renderReader(true); });
    appearance.setAttribute('aria-expanded', String(this.appearanceOpen)); appearance.setAttribute('aria-controls', this.appearanceId);
    const favoriteId = this.relatedContentIds(bundle.entry).find(id => this.plugin.state.favorites[id]);
    const favorite = !!favoriteId;
    const bookmark = this.addIconButton(actions, 'bookmark', favorite ? '取消收藏' : '收藏文章 F', () => this.toggleFavorite());
    bookmark.setAttribute('aria-pressed', String(favorite)); bookmark.toggleClass('is-bookmarked', favorite);
    const later = this.plugin.isLater(bundle.entry.id);
    const laterButton = this.addIconButton(actions, 'clock', later ? '移出稍后读' : '稍后读 M', () => this.run(async () => {
      await this.plugin.toggleLater(bundle.entry); this.renderFilters(); this.renderReader(true); this.renderList();
    }));
    laterButton.setAttribute('aria-pressed', String(later)); laterButton.toggleClass('is-bookmarked', later);
    const relatedIds = this.relatedContentIds(bundle.entry);
    const read = relatedIds.some(id => this.plugin.state.readIds.includes(id));
    const readButton = this.addIconButton(actions, read ? 'circle-check' : 'circle', read ? '标为未读 U' : '标为已读 U', () => this.toggleUnread());
    readButton.setAttribute('aria-pressed', String(read));
    this.addIconButton(actions, 'notebook-pen', '记到今日日记', () => this.noteCurrent());
    const more = this.addIconButton(actions, 'ellipsis', '更多文章操作', () => {
      const menu = new Menu(); const link = safeUrl(bundle.entry.link || '');
      if (bundle.entry.origin === 'vault' && bundle.entry.markdownPath) menu.addItem(item => item.setTitle('打开源文件').setIcon('file-text').onClick(() => {
        void this.app.workspace.openLinkText(bundle.entry.markdownPath!, '', true);
      }));
      if (link) menu.addItem(item => item.setTitle('在浏览器打开原文').setIcon('external-link').onClick(() => { this.contentEl.win.open(link, '_blank', 'noopener,noreferrer'); }));
      const video = safeUrl(bundle.entry.videoUrl || '');
      if (video && youtubeEmbedUrl(video)) menu.addItem(item => item.setTitle('打开本期视频').setIcon('video').onClick(() => { this.contentEl.win.open(video, '_blank', 'noopener,noreferrer'); }));
      menu.addItem(item => item.setTitle('重新加载文章').setIcon('refresh-cw').onClick(() => { void this.openArticle(bundle.entry); }));
      if (Platform.isDesktopApp) {
        menu.addSeparator();
        const mode = this.mode;
        menu.addItem(item => item.setTitle('保存为 Markdown').setIcon('file-text').onClick(() => this.run(async () => {
          const adapter = this.app.vault.adapter as { getBasePath?: () => string };
          const base = adapter.getBasePath?.();
          if (!base) throw new Error('无法读取当前库的本地路径。');
          const result = await saveArticleMarkdown(bundle, mode, this.contentEl.ownerDocument, this.plugin.images, this.plugin.state.settings, base);
          if (result) new Notice(result.missingImages ? `Markdown 已保存，${result.missingImages} 张图片未能离线保存。` : 'Markdown 已保存。');
        })));
        menu.addItem(item => item.setTitle('导出为 PDF').setIcon('file-down').onClick(() => this.run(async () => {
          const article = this.reader.querySelector<HTMLElement>('.qrs-article');
          if (!article || this.bundle?.entry.id !== bundle.entry.id || this.mode !== mode) throw new Error('文章已切换，请重新打开导出菜单。');
          const result = await saveArticlePdf(bundle, mode, article, this.plugin.images, this.plugin.state.settings);
          if (result) new Notice(result.missingImages ? `PDF 已保存，${result.missingImages} 张图片未能导出。` : 'PDF 已保存。');
        })));
      }
      menu.addItem(item => item.setTitle('选择频道').setIcon('rss').onClick(() => this.pickChannel()));
      const rect = more.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
    });
    if (this.appearanceOpen) this.renderAppearanceSettings(toolbar);
    if (previous) { this.reader.append(previous); this.reader.scrollTop = scroll; this.restoreOffsets(); return; }
    const article = this.reader.createEl('article', { cls: 'qrs-article' });
    const title = article.createEl('h1', { text: titleOf(bundle.entry) });
    if ((bundle.entry.sourceId === 'podscribe-all-in-with-chamath-jason-sacks-friedberg' || bundle.entry.sourceId === 'podscribe-the-joe-rogan-experience') &&
      bundle.entry.titleZh?.trim() && bundle.entry.titleZh.trim() !== bundle.entry.title.trim()) {
      title.addClass('qrs-bilingual-title');
      article.createDiv({ cls: 'qrs-article-original-title', text: bundle.entry.title });
    }
    if (podcast) {
      const episode = bundle.entry;
      const date = episode.publishedTs ? new Date(episode.publishedTs).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }) : podcastRelativeDateLabel(episode.publishedRelative);
      const facts = [date,
        episode.podcastViews != null ? `原站浏览 ${episode.podcastViews.toLocaleString()}` : '',
        episode.podcastDurationSeconds ? `时长 ${Math.round(episode.podcastDurationSeconds / 60)} 分钟` : '',
        episode.podcastWordCount ? `${episode.podcastWordCount.toLocaleString()} 词` : ''].filter(Boolean);
      if (facts.length) article.createDiv({ cls: 'qrs-podcast-meta', text: facts.join(' · ') });
    }
    const original = safeUrl(bundle.entry.link || '');
    if (original && wechatArticleKey(original)) {
      title.addClass('qrs-wechat-title');
      const notice = article.createDiv('qrs-wechat-source');
      notice.createSpan({ text: '仅供个人学习阅读，版权归原作者所有。' });
      notice.createEl('a', { text: '查看公众号原文', href: original, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    }
    if (this.message) article.createDiv({ cls: 'qrs-feedback', text: this.message, attr: { role: 'status' } });
    if (!this.articleLoading) renderMedia(article, bundle.entry);
    try {
      if (bundle.entry.origin === 'vault' && bundle.entry.markdown != null) {
        const prose = article.createDiv('qrs-prose');
        this.markdownComponent = new Component(); this.markdownComponent.load();
        void MarkdownRenderer.render(this.app, bundle.entry.markdown, prose, bundle.entry.markdownPath || '', this.markdownComponent)
          .then(() => prepareMarkdownImageDrags(this.app, this.plugin.images, prose, bundle.entry.markdownPath || ''))
          .catch(() => { prose.setText('Markdown 无法显示，请打开源文件。'); });
      } else {
      const fragment = articleFragment(bundle, this.mode, article.ownerDocument, this.plugin.state.settings.remoteImages);
      if (fragment) { this.prepareImages(fragment); article.createDiv('qrs-prose').append(fragment); }
      else if (!this.message || this.articleLoading) article.createDiv({ cls: 'qrs-empty', text: this.articleLoading ? '正在获取正文…' : `${podcast ? this.mode === 'original' ? fullTranscript ? '源文稿' : '节目原文' : this.mode === 'rewrite' ? '乔木改写' : '中文翻译' : modeLabels[this.mode]}暂无正文。可以切换版本，或从“更多”中打开原文。` });
      }
    } catch { article.createDiv({ cls: 'qrs-empty', text: '正文无法显示，请打开原文阅读。' }); }
    this.reader.scrollTop = scroll; this.restoreOffsets();
  }
  private renderAppearanceSettings(anchor: HTMLElement) {
    const settings = this.plugin.state.settings;
    const headingId = `${this.appearanceId}-heading`;
    const panel = anchor.createEl('section', { cls: 'qrs-reading-settings', attr: { id: this.appearanceId, 'aria-labelledby': headingId } });
    const header = panel.createDiv('qrs-reading-settings-head'); header.createEl('strong', { text: '阅读设置', attr: { id: headingId } });
    const fields = panel.createDiv('qrs-reading-settings-fields');
    const row = (label: string) => { const el = fields.createEl('label', { cls: 'qrs-reading-setting' }); el.createSpan({ text: label }); return el; };
    const fontRow = row('字体');
    const font = fontRow.createEl('select', { attr: { 'data-qrs-field': '正文字体' } });
    for (const choice of selectableFonts.concat(readingFonts.filter(f => f.id === settings.fontFamily && !selectableFonts.includes(f)))) font.createEl('option', { value: choice.id, text: choice.name });
    font.value = settings.fontFamily;
    const customRow = row('设备字体名称');
    const custom = customRow.createEl('input', { type: 'text', value: settings.customFont, placeholder: '例如 PingFang SC' });
    customRow.hidden = settings.fontFamily !== 'custom';
    custom.oninput = () => { settings.customFont = custom.value.slice(0, 200); this.applyAppearance(); this.run(() => this.plugin.persist()); };
    const sizeRow = row('字号'); const sizeValue = sizeRow.createEl('output', { text: `${settings.fontSize} px` });
    const size = sizeRow.createEl('input', { type: 'range', value: String(settings.fontSize), attr: { min: '14', max: '32', step: '1', 'data-qrs-field': '正文字号' } });
    const heightRow = row('行距'); const heightValue = heightRow.createEl('output', { text: `${settings.lineHeight.toFixed(1)} 倍` });
    const height = heightRow.createEl('input', { type: 'range', value: String(settings.lineHeight), attr: { min: '1.5', max: '2.4', step: '0.1', 'data-qrs-field': '正文行距' } });
    const widthRow = row('版心宽度');
    const width = widthRow.createEl('select', { attr: { 'data-qrs-field': '正文宽度' } });
    for (const [value, label] of [['28', '紧凑 · 28 字'], ['36', '适中 · 36 字'], ['44', '宽松 · 44 字']] as const) width.createEl('option', { value, text: label });
    width.value = String(settings.lineWidth);
    const update = () => { sizeValue.setText(`${settings.fontSize} px`); heightValue.setText(`${settings.lineHeight.toFixed(1)} 倍`); this.applyAppearance(); };
    font.onchange = () => { settings.fontFamily = readingFontSchema.parse(font.value); customRow.hidden = settings.fontFamily !== 'custom'; update(); this.run(() => this.plugin.persist()); };
    size.oninput = () => { settings.fontSize = Number(size.value); update(); this.run(() => this.plugin.persist()); }; size.onchange = () => this.run(() => this.plugin.persist());
    height.oninput = () => { settings.lineHeight = Number(height.value); update(); this.run(() => this.plugin.persist()); }; height.onchange = () => this.run(() => this.plugin.persist());
    width.onchange = () => { settings.lineWidth = Number(width.value) as 28 | 36 | 44; update(); this.run(() => this.plugin.persist()); };
    panel.onkeydown = event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.appearanceOpen = false; this.renderReader(true); } };
  }
}
