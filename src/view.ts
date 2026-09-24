import { groupsInOrder, personalSources } from './personal-library';
import { SourceIcons } from './source-icons';
import { addSearchClear } from './search-clear';
import { ChannelPicker, channelMark, type ChannelChoice } from './channel-picker';
import { Component, MarkdownRenderer, ItemView, Menu, Notice, Platform, setIcon, TFile, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { vaultSourceId } from './vault-source';
import { enableImageDrag, prepareMarkdownImageDrags } from './image-drag';
import { SelectionCapture } from './selection';
import { readingFonts, selectableFonts, fontFamily } from './fonts';
import { articleFragment } from './content';
import { saveArticlePdf } from './desktop-export';
import { saveArticleToVault } from './vault-export';
import { cleanExcerpt } from './excerpt';
import { AudioDock, pauseVideos, renderMedia, stopMedia, youtubeEmbedUrl } from './media';
import { sameRemoteContent, uniqueRemoteEntries, wechatArticleKey, xiaoyuzhouEpisodeKey } from './wechat-articles';
import { featuredXiaoyuzhouPodcasts, mergeFeaturedPodcasts, qiaomuChannelDivider, qiaomuDividerIcons, qiaomuDividers, qiaomuFeaturedEntries, readerChannelSources } from './discovery';
import { articleNoteKey, modeLabels, modeSchema, podcastDefaultMode, readingFontSchema, safeUrl, titleOf, type ChannelState, type Bundle, type Entry, type Mode } from './model';
export const VIEW_TYPE = 'qiaomu-ai-rss-reader';
type Filter = 'all' | 'unread' | 'favorites';
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
    this.plugin.state.channelStates[this.channelKey()] = {
      entries: this.entries, bundle: this.bundle, mode: this.mode, filter: this.filter, query: this.query,
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
    this.entries = this.source ? saved.entries : qiaomuFeaturedEntries(saved.entries);
    this.bundle = !this.source && saved.bundle && !qiaomuFeaturedEntries([saved.bundle.entry]).length ? null : saved.bundle;
    this.mode = saved.mode;
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
  private audioDock?: AudioDock;
  private status!: HTMLElement;
  private channelButton!: HTMLButtonElement;
  private searchBox!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private welcomeSource?: string;
  private welcomeTip = -1;
  private refreshButton!: HTMLButtonElement;
  private filters!: HTMLElement;
  private entries: Entry[] = [];
  private personalLimit = 100;
  private source = '';
  private filter: Filter = 'all';
  private unreadSession = new Set<string>();
  private query = '';
  private cursor = '';
  private hasMore = false;
  private featuredEpisodes: Entry[] = [];
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
    this.registerDomEvent(this.contentEl.ownerDocument, 'pointerdown', event => {
      const target = event.target as HTMLElement;
      if (!this.appearanceOpen || target.closest?.('.qrs-reading-settings')) return;
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
    stopMedia(this.reader); this.audioDock?.stop();
    this.saveChannel(); this.channelPicker?.close(false); this.stopRestoring();
    if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
    this.selectionCapture?.dispose();
    this.closed = true; this.listVersion++; this.articleVersion++; this.clearImages(); this.clearThumbnails(); this.contentEl.onkeydown = null;
    return this.plugin.persist().catch(() => undefined);
  }
  reset() {
    if (this.reader) stopMedia(this.reader);
    this.audioDock?.stop();
    this.channelPicker?.close(false); this.stopRestoring();
    if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
    this.unreadSession.clear();
    this.closed = false; this.listVersion++; this.articleVersion++; this.clearThumbnails();
    const remembered = this.plugin.state.settings.lastSource;
    const localExists = this.plugin.state.subscriptions.some(feed => feed.id === remembered);
    const groupExists = remembered.startsWith('@group:') && this.plugin.state.subscriptions.some(feed => feed.group === remembered.slice(7));
    this.focused = false; this.source = remembered !== 'levelingup' && (remembered === '@local' || this.plugin.state.settings.markdownFolders.some(folder => vaultSourceId(folder) === remembered) || groupExists || localExists || this.plugin.state.settings.followedPodcasts.includes(remembered) || (qiaomuDividers as readonly string[]).includes(remembered.replace(/^@qiaomu:/, '')) && remembered.startsWith('@qiaomu:') || readerChannelSources(this.plugin.state.sources).some(source => source.id === remembered)) ? remembered : '';
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
  private savedNote(bundle: Bundle, mode: Mode): TFile | null {
    const path = this.plugin.state.articleNotes[articleNoteKey(bundle.entry.id, mode)];
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    return file instanceof TFile ? file : null;
  }
  private saveNote(bundle: Bundle, mode: Mode) {
    this.run(async () => {
      const state = this.plugin.state, progress = new Notice('正在保存文章和图片…', 0);
      const { file, missingImages } = await saveArticleToVault(this.app, bundle, mode, this.contentEl.ownerDocument, this.plugin.images, state.settings.remoteImages, state.settings.articleFolder).finally(() => progress.hide());
      state.articleNotes[articleNoteKey(bundle.entry.id, mode)] = file.path;
      await this.plugin.persist();
      if (this.bundle?.entry.id === bundle.entry.id) this.renderReader(true);
      new Notice(createFragment(f => {
        f.appendText(missingImages ? `已存为笔记，${missingImages} 张图片保留为网络链接。` : '已存为笔记。');
        const open = f.createEl('a', { text: '打开', href: '#' });
        open.onclick = e => { e.preventDefault(); void this.app.workspace.getLeaf('tab').openFile(file); };
      }), 8000);
    });
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
    this.addIconButton(bar, 'plus', '发现订阅', () => { void this.plugin.openDiscovery(); });
    this.addIconButton(bar, 'search', '搜索文章 /', () => this.toggleSearch());
    this.refreshButton = this.addIconButton(bar, 'refresh-cw', '刷新文章', () => { void this.loadEntries(false, true); });
    this.filters = sidebar.createDiv({ cls: 'qrs-filters', attr: { role: 'group' } });
    this.renderFilters();
    this.searchBox = sidebar.createDiv('qrs-search-box'); this.searchBox.toggleClass('is-hidden', !this.query);
    const searchId = `${this.appearanceId}-search`; this.searchBox.createEl('label', { cls: 'qrs-visually-hidden', text: '搜索已载入文章', attr: { for: searchId } });
    this.searchInput = this.searchBox.createEl('input', { type: 'search', placeholder: '搜索当前列表…', attr: { id: searchId } });
    addSearchClear(this.searchInput);
    this.searchInput.value = this.query;
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value; this.unreadSession.clear(); this.renderList(); });
    this.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.toggleSearch(false); } });
    this.status = sidebar.createDiv({ cls: 'qrs-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.list = sidebar.createDiv({ cls: 'qrs-list' });
    this.createResizeHandle(body);
    this.reader = body.createEl('section', { cls: 'qrs-reader', attr: { tabindex: '0' } });
    this.audioDock = new AudioDock(root, entry => this.openEpisode(entry));
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
    for (const [value, label] of [['all', '全部'], ['unread', '未读'], ['favorites', '收藏']] as const) {
      const button = this.filters.createEl('button', { text: label, attr: { 'aria-pressed': String(value === this.filter), 'data-filter': value } });
      button.addEventListener('click', () => { this.filter = value; this.unreadSession.clear(); this.renderFilters(); this.renderList(); });
    }
    this.addIconButton(this.filters, 'settings', '插件设置', () => this.plugin.openSettings()).addClass('qrs-settings-button');
  }
  private channelChoices(): ChannelChoice[] {
    const sources = personalSources(this.plugin.state), groups = groupsInOrder(this.plugin.state);
    return [
      { id: '', name: '乔木精选', short: '全部精选', section: '聚合', subtitle: '乔木筛选的高质量内容', icon: 'tree-deciduous' },
      ...qiaomuDividers.map(divider => ({ id: `@qiaomu:${divider}`, name: divider, section: '乔木分组' as const, subtitle: '乔木精选', icon: qiaomuDividerIcons[divider] })),
      { id: '@local', name: '我的订阅', short: '全部订阅', section: '聚合', subtitle: `${sources.length} 个来源`, icon: 'rss' },
      ...groups.map(group => ({ id: `@group:${group.id}`, name: group.name, section: '订阅分组' as const, subtitle: `${sources.filter(s => s.groupId === group.id).length} 个来源`, icon: 'folder' })),
      ...readerChannelSources(this.plugin.state.sources).map(source => ({ id: source.id, name: source.name, section: '乔木频道' as const, subtitle: source.category || '', monogram: source.name.trim().slice(0, 1), divider: qiaomuChannelDivider(source) })),
      ...sources.map(source => ({ id: source.id, name: source.name, section: '我的订阅源' as const, subtitle: source.detail, group: source.groupId, site: source.site, url: source.url, image: source.image, kind: source.kind })),
    ];
  }
  refreshPersonalSources() {
    if (this.closed || !this.channelButton) return;
    if (this.source.startsWith('@group:') && !this.plugin.state.subscriptionGroups.some(g => g.id === this.source.slice(7)) || (this.source.startsWith('local:') || this.vaultScope()) && !personalSources(this.plugin.state).some(s => s.id === this.source)) { this.selectSource('@local', false); return; }
    this.renderChannel(); this.renderFilters();
    if (this.personalScope()) { this.entries = this.localEntries(); this.renderList(); }
  }
  showPersonalSource(id: string) { this.selectSource(id); }
  private vaultScope() { return this.source.startsWith('@vault:'); }
  private qiaomuGroupIds(source = this.source) {
    const divider = source.startsWith('@qiaomu:') ? source.slice(8) : '';
    return new Set(divider ? readerChannelSources(this.plugin.state.sources).filter(item => qiaomuChannelDivider(item) === divider).map(item => item.id) : []);
  }
  private personalScope() { return this.source === '@local' || this.source.startsWith('@group:') || this.source.startsWith('local:'); }
  private selectedFeeds() {
    return this.plugin.state.subscriptions.filter(feed => this.source === '@local' || feed.id === this.source ||
      (this.source.startsWith('@group:') && this.plugin.state.sourceMeta[feed.id]?.groupId === this.source.slice(7)));
  }
  private localEntries() { return this.selectedFeeds().flatMap(feed => feed.entries).sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0)); }
  showSubscriptions() { this.selectSource('@local', false); }
  showSubscription(id: string) {
    if (this.plugin.state.subscriptions.some(feed => feed.id === id)) this.selectSource(id, false);
  }
  showRemoteSource(id: string) { if (id !== 'levelingup') this.selectSource(id); }
  private pickChannel() {
    if (this.channelPicker) { this.channelPicker.close(); return; }
    this.channelPicker = new ChannelPicker(this.channelButton, this.channelChoices(), this.source, source => this.selectSource(source.id), () => { this.channelPicker = undefined; }, new SourceIcons(this.plugin), { collapsed: this.plugin.state.collapsedGroups, save: (id, collapsed) => { void this.plugin.editLibrary(() => { const state = this.plugin.state; state.collapsedGroups = collapsed ? [...new Set([...state.collapsedGroups, id])] : state.collapsedGroups.filter(g => g !== id); }).catch(() => new Notice('无法保存分组状态。')); } }, () => this.plugin.manageSubscriptions());
    this.channelPicker.load();
  }
  private selectSource(source: string, refresh = true) {
    if (source === this.source) { if (!refresh) void this.loadEntries(); return; }
    this.saveChannel(); this.stopRestoring();
    this.unreadSession.clear();
    this.listVersion++; this.loading = false; this.refreshButton.removeClass('is-loading');
    this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false');
    this.personalLimit = 100; this.source = source; this.cursor = ''; this.entries = []; this.hasMore = false;
    this.plugin.state.settings.lastSource = source; this.run(() => this.plugin.persist());
    this.bundle = null; this.articleVersion++; this.focused = false; this.contentEl.removeClass('qrs-focus');
    this.contentEl.removeClass('qrs-focus'); this.contentEl.removeClass('qrs-has-article');
    this.entries = this.personalScope() ? this.localEntries() : source.startsWith('@qiaomu:') ? this.plugin.state.entries.filter(entry => this.qiaomuGroupIds().has(entry.sourceId)) : source ? [] : qiaomuFeaturedEntries(this.plugin.state.entries);
    this.status.setText(''); this.renderChannel();
    const saved = this.plugin.state.channelStates[this.channelKey()];
    if (saved) { this.restoreChannel(saved); if (!this.entries.length && refresh) void this.loadEntries(); return; }
    this.filter = 'all'; this.query = ''; this.searchInput.value = ''; this.searchBox.addClass('is-hidden'); this.lastListTop = 0; this.lastReaderTop = 0;
    this.renderFilters(); this.renderReader(); this.renderList(); this.list.scrollTop = 0; this.reader.scrollTop = 0;
    if (refresh) void this.loadEntries();
  }
  private toggleSearch(show = this.searchBox.hasClass('is-hidden')) {
    this.focused = false; this.contentEl.removeClass('qrs-focus'); this.showList();
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
  /** On narrow layouts this hides the reader, so a playing video has no visible controls. */
  private showList() { this.contentEl.removeClass('qrs-has-article'); pauseVideos(this.reader); }
  private openEpisode(entry: Entry) {
    if (this.bundle?.entry.id !== entry.id) { void this.openArticle(entry); return; }
    this.contentEl.addClass('qrs-has-article'); this.reader.focus({ preventScroll: true });
  }
  private toggleFocus() {
    if (!this.bundle) return;
    if (this.contentEl.clientWidth <= 650) { this.showList(); return; }
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
    if (event.key === 'Escape') { this.focused = false; this.contentEl.removeClass('qrs-focus'); this.showList(); }
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
        const feeds = [...this.selectedFeeds()].sort((a, b) => (a.lastAttemptAt || a.updatedAt) - (b.lastAttemptAt || b.updatedAt)).slice(0, 20);
        await this.plugin.subscriptions.refresh(feeds.map(feed => feed.id), this.reader.ownerDocument, force, () => {
          if (!this.closed && version === this.listVersion) { this.entries = this.localEntries(); this.renderList(); }
        });
        if (this.closed || version !== this.listVersion) return;
        this.entries = this.localEntries(); this.hasMore = false;
        const failed = feeds.filter(feed => feed.error).length;
        this.status.setText(failed ? `${failed} 个订阅刷新失败，保留已有文章。` : this.selectedFeeds().length > 20 ? '每次刷新读取 20 个较旧来源，可继续刷新。' : '');
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
      if (this.source.startsWith('@qiaomu:')) {
        const ids = [...this.qiaomuGroupIds()], results: PromiseSettledResult<Entry[]>[] = [];
        for (let i = 0; i < ids.length; i += 8) results.push(...await Promise.allSettled(ids.slice(i, i + 8).map(id => api.entries(id, '', 12).then(page => page.entries))));
        if (this.closed || version !== this.listVersion) return;
        const entries = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (!entries.length && failed.length) throw failed[0].reason;
        this.entries = [...new Map(entries.map(entry => [entry.id, entry])).values()].sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0));
        this.cursor = ''; this.hasMore = false;
        await this.plugin.persist();
        if (!this.closed && version === this.listVersion) this.status.setText(failed.length ? `${failed.length} 个频道暂时无法加载。` : '');
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
        this.featuredEpisodes = latest.flatMap(result => result.status === 'fulfilled' ? result.value.entries : []);
      }
      if (!this.source) this.entries = mergeFeaturedPodcasts(this.entries, this.featuredEpisodes, !this.hasMore);
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
    const query = this.query.trim().toLocaleLowerCase(), group = this.qiaomuGroupIds();
    return uniqueRemoteEntries(entries, this.bundle?.entry.id).filter(entry => (this.vaultScope() ? entry.origin === 'vault' && entry.sourceId === this.source : this.personalScope()
      ? entry.origin === 'local' && (this.source === '@local' || this.selectedFeeds().some(feed => feed.id === entry.sourceId))
      : entry.origin !== 'local' && entry.origin !== 'vault' && (!this.source || (this.source.startsWith('@qiaomu:') ? group.has(entry.sourceId) : entry.sourceId === this.source))) &&
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
    const cjk = /[\u3400-\u9fff]/;
    const rewrite = entry.rewrite?.body || this.plugin.state.cache[entry.id]?.rewrite?.body;
    const text = rewrite?.split('\n\n').find(line => cjk.test(line) && !line.startsWith('#') && !line.startsWith('!['));
    // A Chinese title over an untranslated opening ("Hi folks, …") says nothing; the title gets the room instead.
    if (!text && cjk.test(titleOf(entry)) && !cjk.test(entry.summary || '')) return '';
    return cleanExcerpt(text || entry.summary || '');
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
    if (this.source === '@local' || this.source.startsWith('@group:')) {
      const items = personalSources(this.plugin.state).filter(item => item.kind !== 'rss' && (this.source === '@local' || item.groupId === this.source.slice(7)) && (!this.query || item.name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())));
      if (items.length) {
        const sources = this.list.createEl('details', { cls: 'qrs-personal-sources' }); sources.open = true;
        sources.createEl('summary', { text: `播客与本地内容 · ${items.length}` });
        for (const item of items) sources.createEl('button', { text: item.name }).onclick = () => this.selectSource(item.id);
      }
    }
    if (!entries.length) this.list.createDiv({ cls: 'qrs-empty', text: this.loading ? '正在获取文章…' : this.filter === 'favorites' ? '收藏喜欢的文章，在这里慢慢读。' : this.personalScope() && !this.entries.length ? '还没有文章。点击 + 添加订阅，或点击刷新获取文章。' : '暂无匹配文章，试试其他频道或筛选。' });
    // Inside one channel every row would repeat the same source name, so it only appears when sources mix.
    const mixed = new Set(entries.map(entry => entry.sourceId)).size > 1;
    for (const entry of (this.personalScope() ? entries.slice(0, this.personalLimit) : entries)) {
      const relatedIds = this.relatedContentIds(entry);
      const read = relatedIds.some(id => this.plugin.state.readIds.includes(id));
      const row = this.list.createEl('button', { cls: 'qrs-entry', attr: { 'data-entry-id': entry.id } });
      row.toggleClass('qrs-selected', this.bundle?.entry.id === entry.id);
      row.setAttribute('aria-pressed', String(this.bundle?.entry.id === entry.id)); row.toggleClass('qrs-read', read);
      const copy = row.createSpan('qrs-entry-copy');
      const meta = copy.createSpan('qrs-entry-meta');
      if (mixed) meta.createSpan({ text: this.sourceName(entry), cls: 'qrs-source-name' });
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
      const summary = this.excerpt(entry); if (summary) copy.createEl('p', { text: summary, cls: 'qrs-summary' }); else row.addClass('qrs-no-summary');
      this.renderThumbnail(row, entry);
      row.addEventListener('click', () => { void this.openArticle(entry); });
    }
    if (this.personalScope() && entries.length > this.personalLimit) this.list.createEl('button', { text: '显示更多文章', cls: 'qrs-more' }).onclick = () => { this.personalLimit += 100; this.renderList(); };
    if (this.hasMore && this.filter !== 'favorites') {
      const button = this.list.createEl('button', { text: this.loading ? '加载中…' : '加载更早文章', cls: 'qrs-more' });
      button.disabled = this.loading; button.addEventListener('click', () => { void this.loadEntries(true); });
    }
    this.list.scrollTop = scroll;
    if (restoreFocus) this.reader.focus({ preventScroll: true });
  }
  private async openArticle(entry: Entry, resume?: ChannelState) {
    this.stopRestoring();
    // Keep this unread reading session navigable after opening marks entries read.
    if (this.filter === 'unread') this.unreadSession.add(entry.id);
    const version = ++this.articleVersion; const state = this.plugin.state;
    this.audioDock?.open(entry);
    this.bundle = state.cache[entry.id] || state.favorites[entry.id] || { entry, rewrite: entry.rewrite ?? null, translation: null, fetchedAt: 0 };
    state.readIds = [...new Set([...state.readIds, entry.id])].slice(-5000); this.run(() => this.plugin.persist());
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
    this.bundle = bundle; this.mode = mode; this.message = ''; this.audioDock?.open(bundle.entry);
    this.reader.setAttribute('aria-busy', 'false'); this.contentEl.addClass('qrs-has-article');
    this.renderReader(); this.reader.scrollTop = 0; this.lastReaderTop = 0; this.reader.focus({ preventScroll: true }); this.renderList();
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
    // An episode the listener has started keeps playing while they browse; otherwise follow the shown article.
    const dock = this.audioDock;
    if (dock && dock.entry?.id !== this.bundle?.entry.id && !dock.started()) { if (this.bundle) dock.open(this.bundle.entry); else dock.stop(); }
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
        for (const [key, label] of [['J / K', '下篇 / 上篇'], ['[', '收起列表'], ['/', '搜索文章']]) { const item = keys.createSpan(); item.createEl('kbd', { text: key }); item.createSpan({ text: label }); }
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
    const favoriteId = this.relatedContentIds(bundle.entry).find(id => this.plugin.state.favorites[id]);
    const favorite = !!favoriteId;
    const bookmark = this.addIconButton(actions, 'bookmark', favorite ? '取消收藏' : '收藏文章', () => this.run(async () => {
      if (favoriteId) for (const id of this.relatedContentIds(bundle.entry)) delete this.plugin.state.favorites[id];
      else this.plugin.state.favorites[bundle.entry.id] = bundle;
      await this.plugin.persist(); this.renderReader(true); this.renderList();
    }));
    bookmark.setAttribute('aria-pressed', String(favorite)); bookmark.toggleClass('is-bookmarked', favorite);
    const relatedIds = this.relatedContentIds(bundle.entry);
    const read = relatedIds.some(id => this.plugin.state.readIds.includes(id));
    const readButton = this.addIconButton(actions, read ? 'circle-check' : 'circle', read ? '标为未读' : '标为已读', () => this.run(async () => {
      const ids = this.plugin.state.readIds.filter(id => !relatedIds.includes(id));
      this.plugin.state.readIds = read ? ids : [...ids, bundle.entry.id].slice(-5000);
      await this.plugin.persist(); this.renderReader(true); this.renderList();
    }));
    readButton.setAttribute('aria-pressed', String(read));
    // Saving the article as a note is the frequent write action, so it gets a toolbar slot; once saved, the same slot opens that note.
    const mode = this.mode, savedNote = this.savedNote(bundle, mode);
    const noteButton = this.addIconButton(actions, savedNote ? 'file-check' : 'file-plus', savedNote ? '打开已存笔记' : '存为笔记', () => {
      if (savedNote) void this.app.workspace.getLeaf('tab').openFile(savedNote); else this.saveNote(bundle, mode);
    });
    noteButton.setAttribute('aria-pressed', String(!!savedNote));
    this.addIconButton(actions, 'notebook-pen', '记到今日日记', () => this.noteCurrent());
    const more = this.addIconButton(actions, 'ellipsis', '更多文章操作', () => {
      const menu = new Menu().setUseNativeMenu(false); const link = safeUrl(bundle.entry.link || '');
      menu.addItem(item => item.setTitle('阅读设置…').setIcon('type').onClick(() => { this.appearanceOpen = true; this.renderReader(true); }));
      menu.addSeparator();
      if (bundle.entry.origin === 'vault' && bundle.entry.markdownPath) menu.addItem(item => item.setTitle('打开源文件').setIcon('file-text').onClick(() => {
        void this.app.workspace.openLinkText(bundle.entry.markdownPath!, '', true);
      }));
      if (link) menu.addItem(item => item.setTitle('在浏览器打开原文').setIcon('external-link').onClick(() => { this.contentEl.win.open(link, '_blank', 'noopener,noreferrer'); }));
      const video = safeUrl(bundle.entry.videoUrl || '');
      if (video && youtubeEmbedUrl(video)) menu.addItem(item => item.setTitle('打开本期视频').setIcon('video').onClick(() => { this.contentEl.win.open(video, '_blank', 'noopener,noreferrer'); }));
      menu.addItem(item => item.setTitle('重新加载文章').setIcon('refresh-cw').onClick(() => { void this.openArticle(bundle.entry); }));
      menu.addSeparator();
      if (savedNote) menu.addItem(item => item.setTitle('另存一份笔记').setIcon('file-plus').onClick(() => this.saveNote(bundle, mode)));
      if (Platform.isDesktopApp) {
        menu.addItem(item => item.setTitle('导出为 PDF').setIcon('file-down').onClick(() => this.run(async () => {
          const article = this.reader.querySelector<HTMLElement>('.qrs-article');
          if (!article || this.bundle?.entry.id !== bundle.entry.id || this.mode !== mode) throw new Error('文章已切换，请重新打开导出菜单。');
          const result = await saveArticlePdf(bundle, mode, article, this.plugin.images, this.plugin.state.settings);
          if (!result) return;
          await this.plugin.persist();
          new Notice(result.missingImages ? `PDF 已保存，${result.missingImages} 张图片未能导出。` : 'PDF 已保存。');
        })));
      }
      menu.addItem(item => item.setTitle('选择频道').setIcon('rss').onClick(() => this.pickChannel()));
      const rect = more.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
    });
    if (this.appearanceOpen) this.renderAppearanceSettings(toolbar);
    if (previous) { this.reader.append(previous); this.reader.scrollTop = scroll; this.restoreOffsets(); return; }
    const article = this.reader.createEl('article', { cls: 'qrs-article' });
    const title = article.createEl('h1');
    const originalUrl = safeUrl(bundle.entry.link || '');
    if (bundle.entry.origin === 'vault' && bundle.entry.markdownPath) {
      const link = title.createEl('a', { text: titleOf(bundle.entry), href: '#', cls: 'qrs-title-link' });
      link.onclick = event => { event.preventDefault(); void this.app.workspace.openLinkText(bundle.entry.markdownPath!, '', true); };
    } else if (originalUrl) title.createEl('a', { text: titleOf(bundle.entry), href: originalUrl, cls: 'qrs-title-link', attr: { target: '_blank', rel: 'noopener noreferrer' } });
    else title.setText(titleOf(bundle.entry));
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
