import { FeedIndex } from './feed-index';
import { ListWindow } from './list-window';
import { LazyThumbnails } from './lazy-thumbnails';
import { ToolbarTips } from './toolbar-tips';
import type { OutlineContext } from './article-outline';
import { curatedChannels, curatedCommunityChannels, curatedPageEntries, loadCuratedPages, filterCuratedEntries, keepCuratedEntry, pickNewCuratedSources, pickedSources } from './curated-sources';
import type { RssApi } from './api';
import type { CollectionItem } from './collection';
import { todayLabel } from './daily-note';
import { groupsInOrder, personalSources, personalArticleEntries, personalArticleKey } from './personal-library';
import { SourceIcons } from './source-icons';
import { addSearchClear } from './search-clear';
import { ChannelPicker, channelMark, type ChannelChoice } from './channel-picker';
import { Component, MarkdownRenderer, ItemView, Menu, Notice, Platform, setIcon, TFile, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { vaultSourceId } from './vault-source';
import { enableImageDrag, prepareMarkdownImageDrags } from './image-drag';
import { articleSelection } from './speech-source';
import type { CaptureAction } from './selection';
import { SelectionCapture } from './selection';
import { readingFonts, selectableFonts, fontFamily } from './fonts';
import { articleFragment } from './content';
import { saveArticlePdf } from './desktop-export';
import { saveArticleToVault } from './vault-export';
import { exportBaseName } from './article-export';
import { NoteLocationModal } from './note-location';
import { cleanExcerpt } from './excerpt';
import { AudioDock, pauseVideos, renderMedia, stopMedia, videoEmbedUrl } from './media';
import { uniqueRemoteEntries, wechatArticleKey, xiaoyuzhouEpisodeKey } from './wechat-articles';
import { platformOf, PLATFORMS, type LinkPlatform } from './platform';
import { featuredPodcasts, mergeFeaturedPodcasts, qiaomuChannelDivider, qiaomuDividerIcons, qiaomuDividers, qiaomuFeaturedEntries } from './discovery';
import { articleNoteKey, modeLabel, modeSchema, readingFontSchema, readingThemeSchema, safeUrl, titleOf, originalTitleOf, type ChannelState, type Bundle, type Entry, type Mode } from './model';
import { dividerLabel, relativeTime, t } from './i18n';
import { agentAvailable, articleSnapshot, askAgent } from './agent-bridge';
import { notifyContextChanged, type ContextSnapshot } from './qiaomu-context';
import { fontName } from './fonts';
export const VIEW_TYPE = 'qiaomu-ai-rss-reader';
type Filter = 'all' | 'unread' | 'favorites' | 'later';
export class ReaderView extends ItemView {
  openArticleActions?: (anchor: HTMLElement) => void;
  private toolbarTips?: ToolbarTips;
  private channelPicker?: ChannelPicker;
  private restoreObserver?: ResizeObserver;
  private pendingScroll?: { listTop: number; readerTop: number };
  private checkpointTimer?: number;
  private lastListTop = 0;
  private lastReaderTop = 0;
  private channelKey() { return JSON.stringify([this.plugin.state.settings.baseUrl, this.source]); }
  private saveChannel() {
    if (this.collectionScope()) return;
    if (!this.list || !this.reader) return;
    // Strip heavy `content` from channelStates: bodies live in subscriptions and the content
    // cache, so duplicating them here once doubled data.json for every visited channel.
    const strip = (entry: Entry): Entry => entry.content ? { ...entry, content: undefined } : entry;
    this.plugin.state.channelStates[this.channelKey()] = {
      entries: this.personalScope() ? [] : this.entries.map(strip), bundle: this.bundle ? { ...this.bundle, entry: strip(this.bundle.entry) } : null, mode: this.mode, filter: this.filter, query: this.query,
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
    // Re-hydrate body content stripped from channelStates on save; subscriptions hold the single copy.
    const hydrate = (entry: Entry): Entry => {
      if (entry.content) return entry;
      const state = this.plugin.state;
      const found = state.cache[entry.id]?.entry || state.favorites[entry.id]?.entry ||
        (entry.origin === 'local' ? state.subscriptions.find(feed => feed.id === entry.sourceId)?.entries.find(item => item.id === entry.id) : undefined);
      return found?.content ? { ...entry, content: found.content, summary: entry.summary ?? found.summary } : entry;
    };
    const savedBundle = saved.bundle ? { ...saved.bundle, entry: hydrate(saved.bundle.entry) } : null;
    this.entries = this.personalScope() ? this.localEntries() : filterCuratedEntries(this.plugin.state, this.source || this.plugin.state.settings.pickedSourceIds !== null ? saved.entries.map(hydrate) : qiaomuFeaturedEntries(saved.entries.map(hydrate)));
    this.bundle = savedBundle && (this.plugin.articleHidden(savedBundle.entry) || !keepCuratedEntry(this.plugin.state, savedBundle.entry) || !this.source && this.plugin.state.settings.pickedSourceIds === null && !qiaomuFeaturedEntries([savedBundle.entry]).length) ? null : savedBundle;
    this.expandWindowTo(savedBundle?.entry.id);
    this.mode = saved.mode;
    this.filter = saved.filter; this.query = saved.query; this.unreadSession = new Set(saved.unread);
    this.cursor = saved.cursor; this.hasMore = saved.hasMore; this.lastListTop = saved.listTop; this.lastReaderTop = saved.readerTop;
    this.pendingScroll = { listTop: saved.listTop, readerTop: saved.readerTop };
    this.searchInput.value = this.query; this.searchBox.toggleClass('is-hidden', !this.query);
    this.contentEl.toggleClass('qrs-has-article', !!this.bundle);
    this.renderFilters(); this.renderList(); this.renderReader(); this.restoreOffsets();
    if (this.bundle && (saved.articlePending || !this.bundle.entry.content && this.bundle.entry.origin === 'local')) void this.openArticle(this.bundle.entry, saved);
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
  private collectionSettingsButton!: HTMLButtonElement;
  private collectionItems: CollectionItem[] = [];
  private entries: Entry[] = [];
  private virtual = new ListWindow();
  private feedIndex = new FeedIndex();
  private renderSamples: { ms: number; articles: number; rows: number; scroll: boolean }[] = [];
  performanceSamples() { return this.renderSamples.map(sample => ({ ...sample })); }
  private windowEntries: Entry[] = [];
  private windowMixed = false;
  private windowFrame?: number;
  private listWidth = 0;
  private listHeaderHeight = 0;
  private listResize?: ResizeObserver;
  private lazyThumbnails?: LazyThumbnails;
  private searchTimer?: number;
  private composing = false;
  private pendingListUpdate?: () => void;
  private relatedIndex = new Map<string, string[]>();
  private sourceNames = new Map<string, string>();
  private source = '';
  private filter: Filter = 'all';
  private platform: LinkPlatform | 'all' = 'all';
  private unreadSession = new Set<string>();
  private query = '';
  private cursor = '';
  private hasMore = false;
  private featuredEpisodes: Entry[] = [];
  private loading = false;
  private articleLoading = false;
  private articleFailed = false;
  private requestedMode: Mode = 'original';
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
  // Keep thumbnail resources bounded independently of the virtual list.
  private static readonly THUMB_CAP = 60;
  private renderScheduled = false;
  constructor(leaf: WorkspaceLeaf, private plugin: QiaomuRssPlugin) {
    super(leaf); this.mode = plugin.state.settings.defaultMode;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Qiaomu AI RSS'; }
  getIcon() { return 'rss'; }
  onOpen(): Promise<void> {
    this.reset();
    this.toolbarTips = new ToolbarTips(this.contentEl);
    this.registerDomEvent(this.contentEl.ownerDocument, 'pointerdown', event => {
      const target = event.target as HTMLElement;
      if (!this.appearanceOpen || target.closest?.('.qrs-reading-settings,[data-qrs-appearance]')) return;
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
          new Notice(result.added ? t('notice.appendedToNote', { name: result.file.basename }) : t('notice.alreadyInNote'));
        } catch (error) { new Notice(error instanceof Error ? error.message : t('notice.cannotAppend')); }
      };
      const menu = new Menu().setUseNativeMenu(false)
        .addItem(item => item.setTitle(note ? t('capture.appendCurrent', { name: note.basename }) : t('capture.appendCurrentEmpty')).setIcon('file-pen-line').setDisabled(!note).onClick(() => append(true)))
        .addItem(item => item.setTitle(t('capture.appendDailyDated', { date: todayLabel() })).setIcon('calendar-days').onClick(() => append(false)));
      const href = target.closest<HTMLAnchorElement>('a[href]')?.getAttribute('href');
      const link = href ? safeUrl(href, bundle.entry.link || undefined) : null;
      if (link) {
        menu.addSeparator().addItem(item => item.setTitle(t('capture.copyLink')).setIcon('copy').onClick(async () => { try { await this.contentEl.ownerDocument.defaultView!.navigator.clipboard.writeText(link); } catch { new Notice(t('capture.copyFailed')); } }));
        if (this.plugin.state.settings.labCollection) menu.addItem(item => item.setTitle(t('lab.apply')).setIcon('file-audio').onClick(() => this.plugin.submitCollection(link)));
      }
      const speechRange = articleSelection(prose as HTMLElement | null);
      if (speechRange) menu.addSeparator().addItem(item => item.setTitle(t('speech.selection')).setIcon('volume-2').onClick(() => this.plugin.speech.start(this, speechRange)));
      const snapshot = this.agentSnapshot();
      if (snapshot && agentAvailable(this.app)) menu.addSeparator().addItem(item => item.setTitle(t('capture.askAi')).setIcon('sparkles').onClick(() => { void askAgent(this.app, snapshot, excerpt); }));
      menu.showAtMouseEvent(event);
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
          new Notice(result.added ? t('notice.excerptAddedTo', { name: result.file.basename }) : t('notice.excerptAlready'));
        } catch (error) { new Notice(error instanceof Error ? error.message : t('notice.excerptFailed')); }
      };
      const actions: CaptureAction[] = [
        { label: t('capture.appendDaily'), icon: 'calendar-plus', save: (text: string) => capture(text, false) },
        { label: note ? t('capture.appendCurrent', { name: note.basename }) : t('capture.appendCurrentEmpty'), icon: 'file-pen-line', disabled: !note, save: (text: string) => capture(text, true) },
      ];
      // Only when Qiaomu Agent is installed and enabled; checked each time the popup opens.
      const snapshot = agentAvailable(this.app) ? this.agentSnapshot() : null;
      actions.push({ label: t('speech.selection'), icon: 'volume-2', save: async (_text, range) => { this.plugin.speech.start(this, range); } });
      if (snapshot) actions.push({ label: t('capture.askAi'), icon: 'sparkles', save: text => askAgent(this.app, snapshot, text) });
      return actions;
    });
    return Promise.resolve();
  }
  onClose(): Promise<void> {
    this.toolbarTips?.dispose();
    this.plugin.speech?.detach(this);
    stopMedia(this.reader); this.audioDock?.stop();
    this.saveChannel(); this.channelPicker?.close(false); this.stopRestoring();
    if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
    this.listResize?.disconnect(); this.cancelSearch();
    if (this.windowFrame) this.contentEl.ownerDocument.defaultView?.cancelAnimationFrame(this.windowFrame);
    this.selectionCapture?.dispose();
    this.closed = true; this.listVersion++; this.articleVersion++; this.clearImages(); this.clearThumbnails(); this.contentEl.onkeydown = null;
    this.plugin.releaseArticleOutline(this);
    return this.plugin.persist().catch(() => undefined);
  }
  reset() {
    this.toolbarTips?.hide();
    if (this.reader) stopMedia(this.reader);
    this.audioDock?.stop();
    this.channelPicker?.close(false); this.stopRestoring();
    if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
    this.resetWindow(); this.cancelSearch(); this.composing = false; this.listResize?.disconnect();
    this.unreadSession.clear();
    this.closed = false; this.listVersion++; this.articleVersion++; this.clearThumbnails();
    const remembered = this.plugin.state.settings.lastSource;
    const localExists = this.plugin.state.subscriptions.some(feed => feed.id === remembered);
    const groupExists = remembered.startsWith('@group:') && this.plugin.state.subscriptions.some(feed => feed.group === remembered.slice(7));
    this.focused = false; this.source = (remembered !== 'levelingup' || this.plugin.state.settings.pickedSourceIds?.includes(remembered)) && (remembered === '@local' || remembered === '@collection' || remembered === '@collection-all' && this.plugin.collectionAdminAvailable() || this.plugin.state.settings.markdownFolders.some(folder => vaultSourceId(folder) === remembered) || groupExists || localExists || this.plugin.state.settings.followedPodcasts.includes(remembered) || (qiaomuDividers as readonly string[]).includes(remembered.replace(/^@qiaomu:/, '')) && remembered.startsWith('@qiaomu:') || [...curatedChannels(this.plugin.state), ...curatedCommunityChannels(this.plugin.state)].some(source => source.id === remembered)) ? remembered : '';
    this.cursor = ''; this.bundle = null; this.loading = false; this.hasMore = false;
    this.mode = this.plugin.state.settings.defaultMode;
    this.collectionItems = this.source === '@collection' ? this.plugin.collectionLocalItems() : [];
    this.entries = this.personalScope() ? this.localEntries() : this.source ? [] : filterCuratedEntries(this.plugin.state, this.plugin.state.settings.pickedSourceIds === null ? qiaomuFeaturedEntries(this.plugin.state.entries) : this.plugin.state.entries);
    this.build();
    const saved = this.plugin.state.channelStates[this.channelKey()];
    if (saved) { this.restoreChannel(saved); if (!this.entries.length || !this.source) void this.loadEntries(); }
    else { this.renderList(); this.renderReader(); void this.loadEntries(); }
  }
  private run(action: () => Promise<void>) {
    void action().catch(error => { if (!this.closed) new Notice(error instanceof Error ? error.message : t('notice.actionFailed')); });
  }
  private savedNote(bundle: Bundle, mode: Mode): TFile | null {
    const path = this.plugin.state.articleNotes[articleNoteKey(bundle.entry.id, mode)];
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    return file instanceof TFile ? file : null;
  }
  private saveNote(bundle: Bundle, mode: Mode) {
    this.run(() => this.saveNoteAt(bundle, mode, this.plugin.state.settings.articleFolder));
  }
  private async saveNoteAt(bundle: Bundle, mode: Mode, folder: string, remember = false): Promise<void> {
    const state = this.plugin.state, progress = new Notice(t('notice.savingArticle'), 0);
    const { file, missingImages } = await saveArticleToVault(this.app, bundle, mode, this.contentEl.ownerDocument, this.plugin.images, state.settings.remoteImages, folder).finally(() => progress.hide());
    state.articleNotes[articleNoteKey(bundle.entry.id, mode)] = file.path;
    if (remember) state.settings.articleFolder = folder;
    // The note already exists. A settings failure must not send the save
    // dialog back through file creation (and create a duplicate on retry).
    let settingsSaved = true;
    try { await this.plugin.persist(); } catch { settingsSaved = false; }
    if (!this.closed && this.bundle?.entry.id === bundle.entry.id) this.renderReader(true);
    new Notice(createFragment(f => {
      f.appendText(missingImages ? t('notice.savedNoteWithMissing', { n: missingImages }) : t('notice.savedNote'));
      if (!settingsSaved) {
        f.appendText(t('note.settingsSaveFailed'));
        const retry = f.createEl('a', { text: t('common.retry'), href: '#' });
        retry.onclick = e => { e.preventDefault(); this.run(() => this.plugin.persist()); };
      }
      const open = f.createEl('a', { text: t('notice.open'), href: '#' });
      open.onclick = e => { e.preventDefault(); void this.app.workspace.getLeaf('tab').openFile(file); };
    }), 8000);
  }
  private addIconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'clickable-icon qrs-icon', attr: { 'data-qrs-label': label } });
    setIcon(button, icon); button.createSpan({ cls: 'qrs-visually-hidden', text: label }); button.addEventListener('click', action); return button;
  }
  refreshPreferences() { this.selectionCapture?.clear(); this.applyAppearance(); if (this.appearanceOpen) this.renderReader(true); }
  refreshReadingTheme() {
    this.contentEl.dataset.qrsTheme = this.plugin.state.settings.readingTheme;
    for (const select of this.contentEl.querySelectorAll<HTMLSelectElement>('select[data-qrs-reading-theme]')) select.value = this.plugin.state.settings.readingTheme;
    this.channelPicker?.close();
    this.selectionCapture?.clear();
  }
  private applyAppearance() {
    this.refreshReadingTheme();
    const settings = this.plugin.state.settings;
    this.contentEl.dataset.readingFont = settings.fontFamily;
    const font = readingFonts.find(font => font.id === settings.fontFamily)!;
    this.contentEl.setCssProps({ '--qrs-font-family': fontFamily(settings.fontFamily, settings.customFont) });
    void this.plugin.fonts.load(this.contentEl.ownerDocument, settings.fontFamily).catch(() => {
      if (!this.closed && this.plugin.state.settings.fontFamily === font.id) new Notice(t('notice.fontLoadFailed'));
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
    this.channelButton = bar.createEl('button', { cls: 'clickable-icon qrs-channel', attr: { 'aria-haspopup': 'dialog' } });
    this.renderChannel(); this.channelButton.addEventListener('click', () => this.pickChannel());
    const tools = bar.createDiv('qrs-sidebar-actions');
    this.addIconButton(tools, 'plus', t('reader.discover'), () => { void this.plugin.openDiscovery(); });
    this.addIconButton(tools, 'search', t('reader.searchTooltip'), () => this.toggleSearch());
    this.addIconButton(tools, 'list-filter', t('pick.title'), () => this.plugin.pickCuratedSources());
    this.refreshButton = this.addIconButton(tools, 'refresh-cw', t('reader.refresh'), () => { void this.loadEntries(false, true); });
    this.collectionSettingsButton = this.addIconButton(tools, 'settings', t('reader.pluginSettings'), () => this.plugin.openCollectionSettings());
    this.filters = sidebar.createDiv({ cls: 'qrs-filters', attr: { role: 'group' } });
    this.renderFilters();
    this.searchBox = sidebar.createDiv('qrs-search-box'); this.searchBox.toggleClass('is-hidden', !this.query);
    const searchId = `${this.appearanceId}-search`; this.searchBox.createEl('label', { cls: 'qrs-visually-hidden', text: t('reader.searchLabel'), attr: { for: searchId } });
    this.searchInput = this.searchBox.createEl('input', { type: 'search', placeholder: t('reader.searchPlaceholder'), attr: { id: searchId } });
    addSearchClear(this.searchInput);
    this.searchInput.value = this.query;
    this.searchInput.addEventListener('compositionstart', () => { this.composing = true; this.cancelSearch(); });
    this.searchInput.addEventListener('compositionend', () => { this.composing = false; this.queueSearch(); });
    this.searchInput.addEventListener('input', event => { if (!this.composing && !(event as InputEvent).isComposing) this.queueSearch(); });
    this.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing && !this.composing) { event.stopPropagation(); this.toggleSearch(false); } });
    this.status = sidebar.createDiv({ cls: 'qrs-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.list = sidebar.createDiv({ cls: 'qrs-list' });
    this.listResize = new ResizeObserver(() => this.scheduleWindow()); this.listResize.observe(this.list);
    this.list.addEventListener('scroll', () => this.scheduleWindow(), { passive: true });
    this.list.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || event.isComposing) return;
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]');
      if (!row?.dataset.entryId) return;
      const index = this.virtual.position(row.dataset.entryId);
      if (index === undefined) return;
      const next = index + (event.shiftKey ? -1 : 1), id = this.virtual.idAt(next);
      if (!id || this.listRows.has(id)) return;
      event.preventDefault(); this.list.scrollTop = this.listHeaderHeight + this.virtual.offset(next); this.renderList(true);
      this.listRows.get(id)?.row.focus({ preventScroll: true });
    });
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
  private cancelSearch() { if (this.searchTimer) this.contentEl.ownerDocument.defaultView?.clearTimeout(this.searchTimer); this.searchTimer = undefined; }
  private queueSearch() {
    this.cancelSearch();
    const apply = () => { if (this.closed) return; this.query = this.searchInput.value; this.unreadSession.clear(); this.resetWindow(); this.list.scrollTop = 0; this.renderList(); };
    if (!this.searchInput.value || this.entries.length < 500) apply();
    else this.searchTimer = this.contentEl.ownerDocument.defaultView!.setTimeout(apply, 120);
  }
  private scheduleWindow() {
    if (this.closed || this.windowFrame) return;
    this.windowFrame = this.contentEl.ownerDocument.defaultView!.requestAnimationFrame(() => { this.windowFrame = undefined; if (!this.closed) this.renderList(true); });
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
    this.filters.toggleClass('is-hidden', this.collectionScope());
    this.collectionSettingsButton?.toggleClass('is-hidden', !this.collectionScope());
    const readingFilters = this.collectionScope() ? this.filters : this.filters.createDiv('qrs-filter-row');
    if (!this.collectionScope()) for (const [value, label] of [['all', t('common.all')], ['unread', t('reader.filter.unread')], ['favorites', t('reader.filter.favorites')], ['later', t('reader.filter.later')]] as const) {
      const button = readingFilters.createEl('button', { text: label, attr: { 'aria-pressed': String(value === this.filter), 'data-filter': value } });
      button.addEventListener('click', () => { this.filter = value; this.unreadSession.clear(); this.resetWindow(); this.renderFilters(); this.renderList(); });
    }
    // Reader submissions mix video, WeChat and web links, so that channel can be narrowed by where a link comes from.
    if (this.communityScope()) {
      const platformFilters = this.filters.createDiv('qrs-filter-row');
      for (const value of ['all', ...PLATFORMS] as const) {
        const button = platformFilters.createEl('button', { text: value === 'all' ? t('common.all') : t(`platform.${value}`), attr: { 'aria-pressed': String(value === this.platform), 'data-platform': value } });
        button.addEventListener('click', () => { this.platform = value; this.renderFilters(); this.renderList(); });
      }
    }
    if (!this.collectionScope()) this.addIconButton(readingFilters, 'settings', t('reader.pluginSettings'), () => this.plugin.openSettings()).addClass('qrs-settings-button');
  }
  private communityScope() { return curatedCommunityChannels(this.plugin.state).some(source => source.id === this.source); }
  private channelChoices(): ChannelChoice[] {
    const sources = personalSources(this.plugin.state), groups = groupsInOrder(this.plugin.state);
    return [
      { id: '', name: t('reader.featured'), short: t('reader.featuredAll'), section: '聚合', subtitle: t('reader.featuredSubtitle'), icon: 'tree-deciduous' },
      ...qiaomuDividers.map(divider => ({ id: `@qiaomu:${divider}`, name: dividerLabel(divider), section: '乔木分组' as const, subtitle: t('reader.featured'), icon: qiaomuDividerIcons[divider] })),
      { id: '@local', name: t('reader.mySubscriptions'), short: t('reader.allSubscriptions'), section: '聚合', subtitle: t('reader.sourceCount', { n: sources.length }), icon: 'rss' },
      ...(this.plugin.state.settings.labCollection || this.plugin.state.collectionJobs.length ? [{ id: '@collection', name: t('lab.myRequests'), section: '转写入口' as const, subtitle: t('channel.mine'), icon: 'file-audio' }] : []),
      ...(this.plugin.collectionAdminAvailable() ? [{ id: '@collection-all', name: t('lab.userRequests'), section: '转写入口' as const, subtitle: t('channel.mine'), icon: 'users' }] : []),
      ...groups.map(group => ({ id: `@group:${group.id}`, name: group.name, section: '订阅分组' as const, subtitle: t('reader.sourceCount', { n: sources.filter(s => s.groupId === group.id).length }), icon: 'folder' })),
      ...curatedChannels(this.plugin.state).map(source => ({ id: source.id, name: source.name, section: '乔木频道' as const, subtitle: source.category || '', monogram: source.name.trim().slice(0, 1), divider: qiaomuChannelDivider(source) })),
      ...curatedCommunityChannels(this.plugin.state).map(source => ({ id: source.id, name: source.name, section: '读者社区' as const, subtitle: t('channel.community'), icon: 'users' })),
      ...sources.map(source => ({ id: source.id, name: source.name, section: '我的订阅源' as const, subtitle: source.detail, group: source.groupId, site: source.site, url: source.url, image: source.image, kind: source.kind })),
    ];
  }
  refreshPersonalSources() {
    if (this.closed || !this.channelButton) return;
    if (this.source === '@collection-all' && !this.plugin.collectionAdminAvailable()) { this.collectionItems = []; this.selectSource('@collection'); return; }
    if (this.source === '@collection') {
      const local = this.plugin.collectionLocalItems();
      this.collectionItems = [...new Map([...this.collectionItems, ...local].map(item => [item.id, item])).values()].sort((a,b) => b.createdAt - a.createdAt);
      this.renderList();
    }
    if (this.source.startsWith('@group:') && !this.plugin.state.subscriptionGroups.some(g => g.id === this.source.slice(7)) || (this.source.startsWith('local:') || this.vaultScope()) && !personalSources(this.plugin.state).some(s => s.id === this.source)) { this.selectSource('@local', false); return; }
    this.renderChannel(); this.renderFilters();
    if (this.personalScope()) { this.entries = this.localEntries(); this.renderList(); }
  }
  showPersonalSource(id: string) { this.selectSource(id); }
  private collectionScope() { return this.source === '@collection' || this.source === '@collection-all'; }
  refreshMovedArticle(id: string, sourceId: string, sourceName: string) {
    if (this.bundle?.entry.id === id) { Object.assign(this.bundle.entry, { sourceId, sourceName }); this.renderReader(true); }
    this.entries = this.personalScope() ? this.localEntries() : this.entries.filter(entry => entry.id !== id);
    this.renderList();
    if (!this.personalScope() && !this.collectionScope()) void this.loadEntries(false, true);
  }
  moderationEntries() { return [...this.entries, ...(this.bundle ? [this.bundle.entry] : [])]; }
  removeDeletedArticles() {
    this.entries = this.entries.filter(entry => !this.plugin.articleDeleted(entry));
    const deleted = this.plugin.state.deletedEntries[this.plugin.state.settings.baseUrl] || [];
    this.collectionItems = this.collectionItems.filter(job => !job.entryId || !deleted.includes(job.entryId));
    if (this.bundle && this.plugin.articleDeleted(this.bundle.entry)) {
      ++this.articleVersion; this.bundle = null; this.articleLoading = false; this.message = '';
      this.contentEl.removeClass('qrs-has-article'); this.reader.setAttribute('aria-busy', 'false'); this.renderReader();
    }
    this.renderList();
  }
  refreshLocalDeletions(restored: Entry[] = []) {
    if (this.closed || !this.list) return;
    const previous = this.windowEntries;
    for (const entry of restored) if (!this.entries.some(item => item.id === entry.id)) this.entries.push(entry);
    if (this.bundle && this.plugin.localArticleDeleted(this.bundle.entry)) {
      const index = previous.findIndex(entry => entry.id === this.bundle?.entry.id);
      const next = index >= 0 ? previous.slice(index + 1).find(entry => !this.plugin.articleHidden(entry)) : undefined;
      this.plugin.speech.detach(this); stopMedia(this.reader); this.audioDock?.stop(); this.stopRestoring();
      ++this.articleVersion; this.bundle = null; this.articleLoading = false; this.message = '';
      this.contentEl.removeClass('qrs-has-article'); this.reader.setAttribute('aria-busy', 'false');
      this.renderReader(); this.renderList(); this.saveChannel();
      if (next) { const top = this.list.scrollTop; void this.openArticle(next).finally(() => { if (!this.closed) this.list.scrollTop = top; }); }
    } else this.renderList();
  }
  private deleteLocal(entry: Entry) {
    this.run(() => this.plugin.deleteArticleLocally(entry));
  }
  private collectionEntry(job: CollectionItem): Entry {
    return { id: job.entryId!, sourceId: 'user-submitted', origin: 'qiaomu', title: job.title || job.url, link: job.url };
  }
  private vaultScope() { return this.source.startsWith('@vault:'); }
  private qiaomuGroupIds(source = this.source) {
    const divider = source.startsWith('@qiaomu:') ? source.slice(8) : '';
    return new Set(divider ? curatedChannels(this.plugin.state).filter(item => qiaomuChannelDivider(item) === divider).map(item => item.id) : []);
  }
  private personalScope() { return this.source === '@local' || this.source.startsWith('@group:') || this.source.startsWith('local:'); }
  private selectedFeeds() {
    return this.plugin.state.subscriptions.filter(feed => this.source === '@local' || feed.id === this.source ||
      (this.source.startsWith('@group:') && this.plugin.state.sourceMeta[feed.id]?.groupId === this.source.slice(7)));
  }
  private localEntries() { return [...this.feedIndex.update(this.selectedFeeds()), ...personalArticleEntries(this.plugin.state, this.source)].sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0)); }
  showSubscriptions() { this.selectSource('@local', false); }
  showSubscription(id: string) {
    if (this.plugin.state.subscriptions.some(feed => feed.id === id)) this.selectSource(id, false);
  }
  showRemoteSource(id: string) { if (id !== 'levelingup' || this.plugin.state.settings.pickedSourceIds?.includes(id)) this.selectSource(id); }
  private pickChannel() {
    if (this.channelPicker) { this.channelPicker.close(); return; }
    this.channelPicker = new ChannelPicker(this.channelButton, this.channelChoices(), this.source, source => this.selectSource(source.id), () => { this.channelPicker = undefined; }, new SourceIcons(this.plugin), { collapsed: this.plugin.state.collapsedGroups, save: (id, collapsed) => { void this.plugin.editLibrary(() => { const state = this.plugin.state; state.collapsedGroups = collapsed ? [...new Set([...state.collapsedGroups, id])] : state.collapsedGroups.filter(g => g !== id); }).catch(() => new Notice(t('notice.groupStateSaveFailed'))); } }, () => this.plugin.manageSubscriptions());
    this.channelPicker.load();
  }
  private selectSource(source: string, refresh = true) {
    if (source === this.source) { if (!refresh) void this.loadEntries(); return; }
    this.saveChannel(); this.stopRestoring();
    this.unreadSession.clear();
    this.listVersion++; this.loading = false; this.refreshButton.removeClass('is-loading');
    this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false');
    this.collectionItems = source === '@collection' ? this.plugin.collectionLocalItems() : [];
    this.cancelSearch(); this.composing = false; this.resetWindow(); this.source = source; this.cursor = ''; this.entries = []; this.hasMore = false;
    this.plugin.state.settings.lastSource = source; this.run(() => this.plugin.persist());
    this.bundle = null; this.articleVersion++; this.focused = false; this.contentEl.removeClass('qrs-focus');
    this.contentEl.removeClass('qrs-focus'); this.contentEl.removeClass('qrs-has-article');
    this.entries = this.personalScope() ? this.localEntries() : source.startsWith('@qiaomu:') ? this.plugin.state.entries.filter(entry => this.qiaomuGroupIds().has(entry.sourceId)) : source ? [] : filterCuratedEntries(this.plugin.state, this.plugin.state.settings.pickedSourceIds === null ? qiaomuFeaturedEntries(this.plugin.state.entries) : this.plugin.state.entries);
    this.status.setText(''); this.renderChannel();
    const saved = this.plugin.state.channelStates[this.channelKey()];
    if (saved) { this.restoreChannel(saved); if (!this.entries.length && refresh) void this.loadEntries(); return; }
    this.filter = 'all'; this.platform = 'all'; this.query = ''; this.searchInput.value = ''; this.searchBox.addClass('is-hidden'); this.lastListTop = 0; this.lastReaderTop = 0;
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
    handle.createSpan({ cls: 'qrs-visually-hidden', text: t('reader.resizeList'), attr: { id: labelId } });
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
    if (key === 'j' || key === 'k') { event.preventDefault(); event.stopPropagation(); this.navigate(key === 'j' ? 1 : -1); return; }
    if (event.key === '[') { event.preventDefault(); this.toggleFocus(); return; }
    if (event.key === '/') { event.preventDefault(); this.toggleSearch(true); return; }
    if (key === 'f' || key === 'u' || key === 'o' || key === 'e' || key === 'm') {
      const bundle = this.bundle; if (!bundle) return;
      event.preventDefault();
      const relatedIds = this.relatedContentIds(bundle.entry);
      if (key === 'f') this.run(async () => {
        const favoriteId = relatedIds.find(id => this.plugin.state.favorites[id]);
        if (favoriteId) for (const id of this.relatedContentIds(bundle.entry)) delete this.plugin.state.favorites[id];
        else this.plugin.state.favorites[bundle.entry.id] = bundle;
        await this.plugin.persist(); this.renderReader(true); this.renderList();
      });
      else if (key === 'u') this.run(async () => {
        const read = relatedIds.some(id => this.plugin.state.readIds.includes(id));
        const ids = this.plugin.state.readIds.filter(id => !relatedIds.includes(id));
        this.plugin.state.readIds = read ? ids : [...ids, bundle.entry.id].slice(-5000);
        await this.plugin.persist(); this.renderReader(true); this.renderList();
      });
      else if (key === 'o') { const link = safeUrl(bundle.entry.link || ''); if (link) this.contentEl.win.open(link, '_blank', 'noopener,noreferrer'); }
      else if (key === 'e') this.noteCurrent();
      else if (key === 'm') this.run(async () => {
        const queued = await this.plugin.toggleLater(bundle.entry);
        new Notice(queued ? t('reader.addedLater') : t('reader.removedLater'));
        this.renderList();
      });
      return;
    }
    if (event.key === 'Escape' && !event.isComposing && !this.composing) { this.focused = false; this.contentEl.removeClass('qrs-focus'); this.showList(); }
  }
  private navigate(direction: number) {
    const query = this.query.trim().toLocaleLowerCase();
    const entries = this.collectionScope() ? this.collectionItems.filter(job => (!job.entryId || !this.plugin.articleHidden(this.collectionEntry(job))) && job.status === 'complete' && job.entryId && `${job.title} ${job.url} ${job.submitter || ''}`.toLocaleLowerCase().includes(query)).map(job => ({ id: job.entryId!, sourceId: 'user-submitted', origin: 'qiaomu' as const, title: job.title || job.url, link: job.url })) : this.visibleEntries(); const index = entries.findIndex(entry => entry.id === this.bundle?.entry.id);
    const next = entries[index + direction]; if (next) void this.openArticle(next);
  }
  private async syncVisibleTitles(version: number) {
    const state = this.plugin.state, source = this.source;
    const current = () => !this.closed && this.listVersion === version && this.source === source && this.plugin.state === state;
    try {
    const ids = this.visibleEntries().filter(entry => entry.origin !== 'local' && entry.origin !== 'vault' && !entry.titleZh && /[A-Za-z]{3}/.test(entry.title)).slice(0, 40).map(entry => entry.id);
    if (!ids.length) return;
      let result = await this.plugin.api().refreshTitles(ids, true);
      for (let attempt = 0; attempt < 60 && current(); attempt++) {
        let changed = false;
        for (const item of result.titles) {
          if (!item.titleZh) continue;
          for (const entry of this.entries) if (entry.id === item.id && entry.title === item.title && entry.titleZh !== item.titleZh) { entry.titleZh = item.titleZh; changed = true; }
          if (this.bundle?.entry.id === item.id && this.bundle.entry.title === item.title) { this.bundle.entry.titleZh = item.titleZh; }
        }
        if (changed) { this.renderList(); this.renderReader(true); await this.plugin.persist(); }
        if (!result.pending) break;
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        if (!current()) return;
        result = await this.plugin.api().refreshTitles(ids);
      }
    } catch { /* Originals remain usable with old servers or unavailable AI. */ }
  }
  private async loadEntries(more = false, force = false) {
    if (this.loading && more) return;
    const version = ++this.listVersion; this.loading = true; this.status.setText(''); this.refreshButton.addClass('is-loading');
    const state = this.plugin.state;
    try {
      if (force && !more) {
        // Deletion checks update and purge the shared state when ready. They
        // must not hold up unrelated lists or local subscriptions.
        void this.plugin.syncDeletedArticles().catch(() => undefined);
      }
      if (this.collectionScope()) {
        const scope = this.source, page = await this.plugin.collectionPage(scope === '@collection-all', more ? this.cursor : '');
        if (this.closed || version !== this.listVersion || scope !== this.source || scope === '@collection-all' && !this.plugin.collectionAdminAvailable()) return;
        this.collectionItems = more ? [...new Map([...this.collectionItems, ...page.jobs].map(job => [job.id, job])).values()] : page.jobs;
        const deleted = this.plugin.state.deletedEntries[this.plugin.state.settings.baseUrl] || [];
        this.collectionItems = this.collectionItems.filter(job => !job.entryId || !deleted.includes(job.entryId));
        this.hasMore = page.hasMore; this.cursor = page.nextCursor; return;
      }
      if (this.vaultScope()) { this.entries = this.plugin.vaultSources.entries(this.source.slice(7)); this.hasMore = false; return; }
      if (this.personalScope()) {
        const feeds = [...this.selectedFeeds()].sort((a, b) => (a.lastAttemptAt || a.updatedAt) - (b.lastAttemptAt || b.updatedAt));
        await this.plugin.subscriptions.refresh(feeds.map(feed => feed.id), this.reader.ownerDocument, force, (done, total, outcome) => {
          if (this.closed || version !== this.listVersion) return;
          this.status.setText(total > 1 ? t('reader.syncProgress', { done, total }) : '');
          if (outcome === 'changed') this.scheduleRenderList(() => { this.entries = this.localEntries(); });
        }, () => !this.closed && version === this.listVersion);
        if (this.closed || version !== this.listVersion) return;
        this.pendingListUpdate = undefined; this.entries = this.localEntries(); this.hasMore = false;
        const failed = feeds.filter(feed => feed.error).length;
        this.status.setText(failed ? t('reader.refreshFailed', { n: failed }) : '');
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
      const picked = pickedSources(state);
      if (this.source.startsWith('@qiaomu:') || !this.source && picked !== null && picked.size <= 36) {
        const ids = this.source ? [...this.qiaomuGroupIds()] : [...picked!], cached = [...this.entries];
        const current = () => !this.closed && version === this.listVersion && state === this.plugin.state;
        const results = await loadCuratedPages(ids, id => api.entries(id, '', 12).then(page => page.entries), progress => {
          this.scheduleRenderList(() => { this.entries = filterCuratedEntries(state, curatedPageEntries(ids, progress, cached)).filter(entry => !this.plugin.articleDeleted(entry)); });
        }, current);
        if (this.closed || version !== this.listVersion) return;
        const entries = filterCuratedEntries(state, curatedPageEntries(ids, results, cached)).filter(entry => !this.plugin.articleDeleted(entry));
        const failed = results.filter((result): result is PromiseRejectedResult => result?.status === 'rejected');
        if (!entries.length && failed.length) throw failed[0].reason;
        this.entries = [...new Map(entries.map(entry => [entry.id, entry])).values()].sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0));
        this.cursor = ''; this.hasMore = false;
        if (!this.source) { state.entries = this.entries; state.updatedAt = Date.now(); }
        await this.plugin.persist();
        if (!this.closed && version === this.listVersion) this.status.setText(failed.length ? t('reader.channelsUnavailable', { n: failed.length }) : '');
        return;
      }
      // The catalog is supplementary: use the last known channels while it
      // refreshes and never wait for it before showing the article page.
      void this.refreshCatalog(api, version, force);
      const page = await api.entries(this.source, more ? this.cursor : '');
      if (this.closed || version !== this.listVersion) return;
      const pageEntries = filterCuratedEntries(state, this.source || picked !== null ? page.entries : qiaomuFeaturedEntries(page.entries)).filter(entry => !this.plugin.articleDeleted(entry));
      this.entries = more ? [...new Map([...this.entries, ...pageEntries].map(entry => [entry.id, entry])).values()] : pageEntries;
      this.cursor = page.nextCursor || ''; this.hasMore = !!page.hasMore && !!this.cursor;
      if (!this.source && !more) {
        this.renderList();
        const featured = featuredPodcasts(state.sources).filter(source => picked === null || picked.has(source.id));
        void Promise.allSettled(featured.map(source => api.entries(source.id, '', 1))).then(async latest => {
          if (this.closed || version !== this.listVersion || state !== this.plugin.state) return;
          this.featuredEpisodes = latest.flatMap(result => result.status === 'fulfilled' ? result.value.entries : []);
          this.entries = filterCuratedEntries(state, mergeFeaturedPodcasts(this.entries, this.featuredEpisodes, !this.hasMore)).filter(entry => !this.plugin.articleDeleted(entry));
          state.entries = this.entries; this.renderList(); this.saveChannel();
          await this.plugin.persist();
        }).catch(() => undefined);
      }
      if (!this.source) this.entries = filterCuratedEntries(state, mergeFeaturedPodcasts(this.entries, this.featuredEpisodes, !this.hasMore));
      if (!this.source) { state.entries = this.entries; state.updatedAt = Date.now(); }
      await this.plugin.persist();
      if (this.closed || version !== this.listVersion) return;
    } catch (error) {
      if (this.closed || version !== this.listVersion) return;
      this.status.setText(`${error instanceof Error ? error.message : t('error.networkUnavailable')}${this.entries.length ? t('reader.showingCached') : t('reader.refreshRetry')}`);
    } finally {
      if (!this.closed && version === this.listVersion) { this.loading = false; this.refreshButton.removeClass('is-loading'); this.renderList();
        if (force && !more && !this.personalScope() && !this.vaultScope() && !this.collectionScope()) void this.syncVisibleTitles(version);
      }
    }
  }
  private catalogFeedback(message: string, retry: () => Promise<void>) {
    const previous = this.status.querySelector('.qrs-catalog-feedback');
    if (this.status.textContent && !previous) return; // Keep primary list errors visible.
    previous?.remove();
    const feedback = this.status.createDiv('qrs-catalog-feedback');
    feedback.createSpan({ text: message });
    const button = feedback.createEl('button', { text: t('common.retry'), cls: 'qrs-feedback-retry' });
    button.onclick = () => { button.disabled = true; void retry().finally(() => { button.disabled = false; }); };
  }
  private async refreshCatalog(api: RssApi, version: number, force: boolean) {
    const state = this.plugin.state;
    const current = () => !this.closed && version === this.listVersion && state === this.plugin.state;
    let result: Awaited<ReturnType<RssApi['sources']>>;
    try { result = await api.sources(force); }
    catch (error) {
      if (!current()) return;
      console.warn('[Qiaomu RSS] Catalog request failed', error);
      this.catalogFeedback(t(state.sources.length ? 'reader.catalogCached' : 'reader.channelsFailed'), () => this.refreshCatalog(api, version, true));
      return;
    }
    if (!current()) return;
    state.sources = result.sources;
    pickNewCuratedSources(state);
    // A local UI/storage error must not be reported as a failed network request.
    const apply = async () => {
      if (!current()) return;
      try {
        this.renderChannel(); this.renderFilters();
        await this.plugin.persist();
        if (current()) this.status.querySelector('.qrs-catalog-feedback')?.remove();
      } catch (error) {
        if (!current()) return;
        console.warn('[Qiaomu RSS] Catalog state update failed', error);
        this.catalogFeedback(t('reader.catalogSaveFailed'), apply);
      }
    };
    await apply();
  }
  private contentKey(entry: Entry) { const key = wechatArticleKey(entry.link) || xiaoyuzhouEpisodeKey(entry.link); return key ? `${entry.sourceId}:${key}` : ''; }
  private visibleEntries(): Entry[] {
    const state = this.plugin.state;
    this.sourceNames = new Map([...state.sources.map(source => [source.id, source.name] as const), ...state.subscriptions.map(feed => [feed.id, feed.name] as const)]);
    this.relatedIndex.clear();
    for (const entry of [...this.entries, ...Object.values(state.favorites).map(bundle => bundle.entry)]) {
      const key = this.contentKey(entry); if (!key) continue;
      const ids = this.relatedIndex.get(key); if (ids) { if (!ids.includes(entry.id)) ids.push(entry.id); } else this.relatedIndex.set(key, [entry.id]);
    }
    const readIds = new Set(state.readIds), selected = new Set(this.selectedFeeds().map(feed => feed.id));
    // Read-later is a cross-source queue: it resolves ids against every stored entry in queue order.
    let entries: Entry[];
    if (this.filter === 'favorites') entries = Object.values(state.favorites).map(b => b.entry);
    else if (this.filter === 'later') {
      const byId = new Map<string, Entry>();
      for (const feed of state.subscriptions) for (const entry of feed.entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
      for (const entry of state.entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
      for (const bundle of Object.values(state.favorites)) if (!byId.has(bundle.entry.id)) byId.set(bundle.entry.id, bundle.entry);
      for (const bundle of Object.values(state.savedArticles)) if (!byId.has(bundle.entry.id)) byId.set(bundle.entry.id, bundle.entry);
      for (const entry of personalArticleEntries(state, '@local')) if (!byId.has(entry.id)) byId.set(entry.id, entry);
      entries = state.readLater.map(id => byId.get(id)).filter((entry): entry is Entry => !!entry);
    } else entries = this.entries;
    const query = this.query.trim().toLocaleLowerCase(), group = this.qiaomuGroupIds();
    const personalIds = new Set(personalArticleEntries(state, this.source).map(entry => entry.id));
    const inScope = (entry: Entry) => this.vaultScope() ? entry.origin === 'vault' && entry.sourceId === this.source : this.personalScope()
      ? personalIds.has(entry.id) || entry.origin === 'local' && (this.source === '@local' || selected.has(entry.sourceId))
      : entry.origin !== 'local' && entry.origin !== 'vault' && (!this.source || (this.source.startsWith('@qiaomu:') ? group.has(entry.sourceId) : entry.sourceId === this.source));
    return uniqueRemoteEntries(entries, this.bundle?.entry.id).filter(entry => (this.filter === 'later' || inScope(entry)) &&
      !this.plugin.articleHidden(entry) && (personalIds.has(entry.id) || keepCuratedEntry(state, entry)) && (personalIds.has(entry.id) || state.settings.pickedSourceIds !== null || entry.sourceId !== 'levelingup') && (this.platform === 'all' || !this.communityScope() || platformOf(entry.link) === this.platform) &&
      (this.filter !== 'unread' || !this.relatedContentIds(entry).some(id => readIds.has(id)) || this.unreadSession.has(entry.id) || entry.id === this.bundle?.entry.id) &&
      (!query || `${titleOf(entry)} ${entry.title} ${entry.summary || ''} ${this.sourceName(entry)}`.toLocaleLowerCase().includes(query)));
  }
  private relatedContentIds(entry: Entry): string[] {
    const ids = this.relatedIndex.get(this.contentKey(entry));
    return ids ? (ids.includes(entry.id) ? ids : [entry.id, ...ids]) : [entry.id];
  }
  private sourceName(entry: Entry) { return this.sourceNames.get(entry.sourceId) || entry.sourceName || this.plugin.state.settings.podcastNames[entry.sourceId] || entry.sourceId; }
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
    this.listRows.clear(); this.lazyThumbnails?.dispose(); this.lazyThumbnails = undefined;
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
    this.lazyThumbnails ??= new LazyThumbnails(this.list);
    this.lazyThumbnails.observe(holder, async () => {
      const local = await this.thumbnailUrl(url);
      if (!local || !holder.isConnected) { holder.remove(); return; }
      img.onload = () => holder.removeClass('is-loading'); img.onerror = () => holder.remove(); img.src = local;
    });
  }
  private renderCollectionList() {
    const scroll = this.list.scrollTop;
    const focusedId = (this.contentEl.ownerDocument.activeElement as HTMLElement)?.closest('[data-collection-id]')?.getAttribute('data-collection-id');
    this.list.empty();
    const query = this.query.trim().toLocaleLowerCase();
    const items = this.collectionItems.filter(job => (!job.entryId || !this.plugin.articleHidden(this.collectionEntry(job))) && `${job.title} ${job.url} ${job.submitter || ''}`.toLocaleLowerCase().includes(query));
    if (!items.length) this.list.createDiv({ cls: 'qrs-collection-empty', text: this.loading ? t('reader.loadingEntries') : query ? t('reader.emptyFilter') : t('lab.emptyRequests') });
    for (const job of items) {
      const row = this.list.createDiv({ cls: 'qrs-entry qrs-collection-entry', attr: { 'data-collection-id': job.id } });
      row.toggleClass('qrs-selected', !!job.entryId && job.entryId === this.bundle?.entry.id);
      const copy = row.createDiv('qrs-entry-copy');
      const url = safeUrl(job.url);
      const meta = copy.createSpan('qrs-entry-meta');
      meta.createSpan({ cls: 'qrs-source-name', text: url ? new URL(url).hostname : job.url });
      meta.createSpan({ cls: 'qrs-date', text: new Date(job.createdAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) });
      copy.createDiv('qrs-entry-title').createEl('h3', { text: job.title || job.url });
      const status = copy.createDiv('qrs-summary qrs-collection-status');
      setIcon(status.createSpan({ attr: { 'aria-hidden': 'true' } }), { complete: 'check', running: 'loader-circle', queued: 'clock-3', failed: 'circle-alert' }[job.status]);
      status.createSpan({ text: [t(`lab.status.${job.status}`), job.status === 'failed' && job.failure ? t(`lab.failure.${job.failure}`) : '', job.submitter].filter(Boolean).join(' · ') });
      if (url) row.oncontextmenu = event => {
        event.preventDefault();
        const menu = new Menu();
        if (job.entryId && this.plugin.collectionAdminAvailable()) menu.addItem(item => item.setTitle(t('moderation.move')).setIcon('folder-input').onClick(() => this.plugin.openMoveArticle(this.collectionEntry(job))));
        if (job.entryId) menu.addItem(item => item.setTitle(t('localDelete.action')).setIcon('trash-2').onClick(() => this.deleteLocal(this.collectionEntry(job))));
        menu.addItem(item => item.setTitle(t('capture.copyLink')).setIcon('link').onClick(() => { void navigator.clipboard.writeText(url); }));
        menu.showAtMouseEvent(event);
      };
      if (job.status === 'complete' && job.entryId) {
        row.setAttribute('role', 'button'); row.setAttribute('aria-pressed', String(job.entryId === this.bundle?.entry.id)); row.tabIndex = 0;
        const open = () => { void this.openArticle({ id: job.entryId!, sourceId: 'user-submitted', origin: 'qiaomu', title: job.title || job.url, link: job.url }); };
        row.onclick = e => { if (!(e.target as HTMLElement).closest('a,button')) open(); };
        row.onkeydown = e => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };
      } else if (job.status === 'failed' && this.source === '@collection') {
        const retry = copy.createEl('button', { text: t('lab.retry'), cls: 'qrs-collection-retry' });
        retry.onclick = () => { void this.plugin.submitCollection(job.url); };
      }
    }
    if (this.hasMore) { const more = this.list.createEl('button', { text: t('reader.loadEarlier'), cls: 'qrs-more' }); more.disabled = this.loading; more.onclick = () => { void this.loadEntries(true); }; }
    this.list.scrollTop = scroll;
    if (focusedId) Array.from(this.list.querySelectorAll<HTMLElement>('[data-collection-id]')).find(row => row.dataset.collectionId === focusedId)?.focus({ preventScroll: true });
  }
  /** A new channel or query starts with an empty virtual window. */
  private resetWindow() {
    this.windowEntries = []; this.virtual.setItems([]); this.pendingListUpdate = undefined;
  }
  private expandWindowTo(entryId?: string) {
    if (!entryId || !this.list) return;
    this.virtual.setItems(this.visibleEntries().map(entry => entry.id));
    const index = this.virtual.position(entryId); if (index === undefined) return;
    const top = this.virtual.offset(index) + this.listHeaderHeight;
    if (top < this.list.scrollTop || top > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = top;
  }
  private scheduleRenderList(update?: () => void) {
    if (update) this.pendingListUpdate = update;
    if (this.renderScheduled || this.closed) return;
    this.renderScheduled = true;
    this.contentEl.ownerDocument.defaultView!.requestAnimationFrame(() => {
      this.renderScheduled = false;
      if (!this.closed) { this.pendingListUpdate?.(); this.pendingListUpdate = undefined; this.renderList(); }
    });
  }
  /** Thumbnail object URLs are capped so a long session cannot leak blobs. */
  private cacheThumbnail(url: string, local: string) {
    if (this.thumbnailUrls.has(url)) return;
    this.thumbnailUrls.set(url, local);
    // Evict oldest entries beyond the cap; one insert evicts at most one.
    for (const oldest of this.thumbnailUrls.keys()) {
      if (this.thumbnailUrls.size <= ReaderView.THUMB_CAP) break;
      URL.revokeObjectURL(this.thumbnailUrls.get(oldest)!);
      this.thumbnailUrls.delete(oldest);
    }
  }
  private listRows = new Map<string, { key: string; row: HTMLElement; entry: Entry }>();
  private renderList(windowOnly = false) {
    const started = performance.now();
    if (this.collectionScope()) { this.listRows.clear(); this.renderCollectionList(); return; }
    const restoreFocus = this.list.contains(this.contentEl.ownerDocument.activeElement);
    const focused = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
    let scroll = this.list.scrollTop;
    const oldIndex = this.virtual.indexAt(Math.max(0, scroll - this.listHeaderHeight));
    const anchor = this.virtual.idAt(oldIndex), anchorDelta = scroll - this.listHeaderHeight - this.virtual.offset(oldIndex);
    const entries = windowOnly && this.windowEntries.length ? this.windowEntries : this.visibleEntries();
    if (!windowOnly || !this.windowEntries.length) { this.virtual.setItems(entries.map(entry => entry.id)); this.windowMixed = new Set(entries.map(entry => entry.sourceId)).size > 1; }
    this.windowEntries = entries;
    const width = this.list.clientWidth;
    if (width && width !== this.listWidth) { this.listWidth = width; this.virtual.clearMeasurements(); }
    const anchorIndex = anchor ? this.virtual.position(anchor) : undefined;
    if (scroll > 0 && anchorIndex !== undefined) scroll = this.listHeaderHeight + this.virtual.offset(anchorIndex) + anchorDelta;
    const range = this.virtual.range(Math.max(0, scroll - this.listHeaderHeight), this.list.clientHeight || 600);
    const readIds = new Set(this.plugin.state.readIds);
    const output = this.list.ownerDocument.createElement('div');
    const ordered: HTMLElement[] = [];
    const rows = new Map<string, { key: string; row: HTMLElement; entry: Entry }>();
    if (this.source === '@local' || this.source.startsWith('@group:')) {
      const items = personalSources(this.plugin.state).filter(item => item.kind !== 'rss' && (this.source === '@local' || item.groupId === this.source.slice(7)) && (!this.query || item.name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())));
      if (items.length) {
        const sources = output.createEl('details', { cls: 'qrs-personal-sources' }); sources.open = true;
        sources.createEl('summary', { text: t('reader.podcastLocalSection', { n: items.length }) });
        for (const item of items) sources.createEl('button', { text: item.name }).onclick = () => this.selectSource(item.id);
      }
    }
    if (!entries.length) output.createDiv({ cls: 'qrs-empty', text: this.loading ? t('reader.loadingEntries') : this.filter === 'favorites' ? t('reader.emptyFavorites') : this.filter === 'later' ? t('reader.emptyLater') : this.personalScope() && !this.entries.length ? t('reader.emptyPersonal') : t('reader.emptyFilter') });
    // Inside one channel every row would repeat the same source name, so it only appears when sources mix.
    const mixed = this.windowMixed;
    const before = output.createDiv({ cls: 'qrs-window-spacer', attr: { 'aria-hidden': 'true' } });
    before.setCssProps({ '--qrs-window-height': `${range.before}px` });
    ordered.push(...Array.from(output.children) as HTMLElement[]); output.empty();
    for (const entry of entries.slice(range.start, range.end)) {
      const relatedIds = this.relatedContentIds(entry);
      const read = relatedIds.some(id => readIds.has(id));
      const summary = this.excerpt(entry);
      const key = JSON.stringify([entry.title, entry.titleZh, entry.sourceId, entry.publishedTs, entry.published,
        entry.publishedRelative, entry.podcastViews, entry.podcastDurationSeconds, entry.image, entry.link,
        mixed && this.sourceName(entry), summary, read, relatedIds.some(id => this.plugin.state.favorites[id]),
        this.plugin.state.settings.remoteImages, t('reader.read')]);
      const cached = this.listRows.get(entry.id);
      if (cached?.key === key) {
        cached.entry = entry;
        cached.row.toggleClass('qrs-selected', this.bundle?.entry.id === entry.id);
        cached.row.setAttribute('aria-pressed', String(this.bundle?.entry.id === entry.id));
        rows.set(entry.id, cached); ordered.push(cached.row); continue;
      }
      const row = output.createEl('button', { cls: 'qrs-entry', attr: { 'data-entry-id': entry.id } });
      const record = { key, row, entry }; rows.set(entry.id, record); ordered.push(row);
      row.toggleClass('qrs-selected', this.bundle?.entry.id === entry.id);
      row.setAttribute('aria-pressed', String(this.bundle?.entry.id === entry.id)); row.toggleClass('qrs-read', read);
      const copy = row.createSpan('qrs-entry-copy');
      const meta = copy.createSpan('qrs-entry-meta');
      if (mixed) meta.createSpan({ text: this.sourceName(entry), cls: 'qrs-source-name' });
      const date = entry.publishedTs ? new Date(entry.publishedTs) : entry.published ? new Date(entry.published) : null;
      meta.createSpan({ cls: 'qrs-date', text: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : relativeTime(entry.publishedRelative || '') });
      if (entry.sourceId.startsWith('podscribe-')) {
        const details = [entry.podcastViews != null ? t('reader.originalViews', { n: entry.podcastViews.toLocaleString() }) : '',
          entry.podcastDurationSeconds ? t('reader.minutes', { n: Math.round(entry.podcastDurationSeconds / 60) }) : ''].filter(Boolean).join(' · ');
        if (details) meta.createSpan({ cls: 'qrs-podcast-facts', text: details });
      }
      const title = copy.createDiv('qrs-entry-title');
      title.createSpan({ cls: read ? 'qrs-read-dot' : 'qrs-unread-dot', attr: { 'aria-hidden': 'true' } });
      title.createSpan({ cls: 'qrs-visually-hidden', text: read ? t('reader.read') : t('reader.unread') });
      const bilingual = originalTitleOf(entry);
      const heading = bilingual ? title.createDiv('qrs-bilingual-heading') : title;
      heading.createEl('h3', { text: titleOf(entry) });
      if (bilingual) heading.createDiv({ cls: 'qrs-original-title', text: bilingual, attr: { lang: 'en' } });
      if (relatedIds.some(id => this.plugin.state.favorites[id])) setIcon(title.createSpan('qrs-bookmarked'), 'bookmark');
      if (summary) copy.createEl('p', { text: summary, cls: 'qrs-summary' }); else row.addClass('qrs-no-summary');
      this.renderThumbnail(row, entry);
      row.addEventListener('click', () => { void this.openArticle(record.entry); });
      if (entry.origin !== 'vault') row.addEventListener('contextmenu', event => {
        event.preventDefault();
        const menu = new Menu().setUseNativeMenu(false);
        if (this.plugin.canDeleteArticle(record.entry)) menu.addItem(item => item.setTitle(t('moderation.move')).setIcon('folder-input').onClick(() => this.plugin.openMoveArticle(record.entry)));
        menu.addItem(item => item.setTitle(t('localDelete.action')).setIcon('trash-2').onClick(() => this.deleteLocal(record.entry))).showAtMouseEvent(event);
      });
    }
    output.empty();
    const after = output.createDiv({ cls: 'qrs-window-spacer', attr: { 'aria-hidden': 'true' } });
    after.setCssProps({ '--qrs-window-height': `${range.after}px` });
    if (this.hasMore && this.filter !== 'favorites' && this.filter !== 'later') {
      const button = output.createEl('button', { text: this.loading ? t('reader.loadingMore') : t('reader.loadEarlier'), cls: 'qrs-more' });
      button.disabled = this.loading; button.addEventListener('click', () => { void this.loadEntries(true); });
    }
    ordered.push(...Array.from(output.children) as HTMLElement[]);
    const wanted = new Set(ordered);
    for (const child of Array.from(this.list.children)) if (!wanted.has(child as HTMLElement)) child.remove();
    let cursor = this.list.firstElementChild;
    for (const node of ordered) {
      if (node === cursor) cursor = cursor.nextElementSibling;
      else this.list.insertBefore(node, cursor);
    }
    this.listRows = rows;
    this.listHeaderHeight = ordered.filter(el => el.classList.contains('qrs-personal-sources')).reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
    // Measure only mounted rows, then keep the same article at the same pixel offset.
    for (const [id, record] of rows) this.virtual.measure(id, record.row.getBoundingClientRect().height);
    before.setCssProps({ '--qrs-window-height': `${this.virtual.offset(range.start)}px` });
    after.setCssProps({ '--qrs-window-height': `${this.virtual.total - this.virtual.offset(range.end)}px` });
    if (scroll > 0 && anchorIndex !== undefined) scroll = this.listHeaderHeight + this.virtual.offset(anchorIndex) + anchorDelta;
    this.lazyThumbnails?.prune();
    this.list.scrollTop = scroll;
    if (restoreFocus && !focused?.isConnected) (rows.get(focused?.dataset.entryId || '')?.row || this.reader).focus({ preventScroll: true });
    this.renderSamples.push({ ms: performance.now() - started, articles: entries.length, rows: rows.size, scroll: windowOnly });
    if (this.renderSamples.length > 60) this.renderSamples.shift();
  }
  private async openArticle(entry: Entry, resume?: ChannelState, preferredMode?: Mode) {
    if (this.plugin.articleHidden(entry)) { new Notice(t(this.plugin.localArticleDeleted(entry) ? 'localDelete.done' : 'moderation.deleted')); return; }
    this.stopRestoring();
    // Keep this unread reading session navigable after opening marks entries read.
    if (this.filter === 'unread') this.unreadSession.add(entry.id);
    this.expandWindowTo(entry.id);
    const version = ++this.articleVersion; const state = this.plugin.state;
    this.audioDock?.open(entry);
    this.bundle = state.personalArticles[personalArticleKey(state.settings.baseUrl, entry.id)]?.bundle || state.cache[entry.id] || state.favorites[entry.id] || { entry, rewrite: entry.rewrite ?? null, translation: null, fetchedAt: 0 };
    state.readIds = [...new Set([...state.readIds, entry.id])].slice(-5000);
    // Open time feeds the 30-day source health stats; the queue consumes itself on open.
    state.readAt[entry.id] = Date.now();
    const readSet = new Set(state.readIds);
    for (const id of Object.keys(state.readAt)) if (!readSet.has(id)) delete state.readAt[id];
    if (this.plugin.isLater(entry.id)) void this.plugin.toggleLater(entry).then(() => { if (!this.closed) this.renderList(); });
    this.run(() => this.plugin.persist());
    this.mode = entry.origin === 'local' || entry.origin === 'vault' ? 'original'
      : entry.podcastSlug ? 'original' : state.settings.defaultMode;
    this.requestedMode = preferredMode ?? resume?.mode ?? this.mode;
    this.mode = this.availableMode(this.requestedMode);
    const ready = this.mode === 'original' ? !!this.bundle.entry.content?.trim() : this.mode === 'rewrite' ? !!this.bundle.rewrite?.body.trim() : !!this.bundle.translation?.content?.length;
    this.message = ''; this.articleFailed = false; this.articleLoading = !ready; this.reader.setAttribute('aria-busy', String(this.articleLoading));
    this.contentEl.addClass('qrs-has-article'); this.renderReader(); this.reader.scrollTop = 0; this.lastReaderTop = 0; this.reader.focus({ preventScroll: true }); this.renderList();
    if (resume) { this.pendingScroll = { listTop: resume.listTop, readerTop: resume.readerTop }; this.renderReader(); this.restoreOffsets(); }
    if (entry.origin === 'local') {
      try {
        const hydrated = await this.plugin.localArticle(entry, this.reader.ownerDocument);
        if (this.closed || version !== this.articleVersion) return;
        this.bundle = { entry: hydrated, rewrite: null, translation: null, fetchedAt: Date.now() };
        this.plugin.remember(this.bundle); this.run(() => this.plugin.persist());
      } catch (error) { if (this.closed || version !== this.articleVersion) return; this.articleFailed = true; this.message = error instanceof Error ? error.message : t('reader.contentFailed'); }
      this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false'); this.renderReader(); return;
    }
    let originalShown = false;
    try {
      if (!this.bundle.entry.content) {
        const hydrated = await this.plugin.hydrateEntry(this.bundle.entry).catch(() => this.bundle!.entry);
        if (this.closed || version !== this.articleVersion) return;
        this.bundle = { ...this.bundle, entry: hydrated };
        if (hydrated.content) { this.articleLoading = false; this.renderReader(); }
      }
      const { bundle, warnings } = entry.origin === 'vault' ? { bundle: await this.plugin.vaultSources.article(entry), warnings: [] } : await this.plugin.api().article(entry.id, entry, content => {
        if (this.closed || version !== this.articleVersion || this.plugin.articleHidden(entry)) return;
        this.bundle = { ...content, rewrite: content.rewrite ?? this.bundle?.rewrite ?? null, translation: content.translation ?? this.bundle?.translation ?? null };
        this.mode = this.availableMode(this.requestedMode);
        this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false');
        this.renderReader(originalShown && this.mode === 'original');
        originalShown = this.mode === 'original';
        this.plugin.remember(this.bundle); this.run(() => this.plugin.persist());
      });
      if (this.closed || version !== this.articleVersion || this.plugin.articleHidden(entry)) return;
      this.bundle = bundle; this.message = warnings.join('；');
      this.plugin.remember(bundle); this.run(() => this.plugin.persist());
    } catch (error) {
      if (this.closed || version !== this.articleVersion) return;
      this.articleFailed = true;
      const cached = this.bundle.fetchedAt ? t('reader.cachedAt', { date: new Date(this.bundle.fetchedAt).toLocaleString() }) : t('reader.reopenRetry');
      this.message = `${error instanceof Error ? error.message : t('reader.contentFailed')}${cached}`;
    }
    if (!this.closed && version === this.articleVersion) {
      this.mode = this.availableMode(this.requestedMode);
      this.articleLoading = false; this.reader.setAttribute('aria-busy', 'false'); this.renderReader(originalShown && this.mode === 'original'); this.renderList();
    }
  }
  private availableMode(mode: Mode): Mode {
    return mode === 'rewrite' && !this.bundle?.rewrite?.body.trim() || mode === 'translation' && !this.bundle?.translation?.content?.length ? 'original' : mode;
  }
  /** Opens one article from outside the list, e.g. from Qiaomu Home. */
  openEntry(entry: Entry) { void this.openArticle(entry); }
  showSavedArticle(bundle: Bundle, mode: Mode) {
    if (this.plugin.articleHidden(bundle.entry)) { new Notice(t(this.plugin.localArticleDeleted(bundle.entry) ? 'localDelete.done' : 'moderation.deleted')); return; }
    this.stopRestoring();
    this.articleVersion++; this.articleLoading = false; this.articleFailed = false;
    this.bundle = bundle; this.mode = mode; this.message = ''; this.audioDock?.open(bundle.entry);
    this.reader.setAttribute('aria-busy', 'false'); this.contentEl.addClass('qrs-has-article');
    this.renderReader(); this.reader.scrollTop = 0; this.lastReaderTop = 0; this.reader.focus({ preventScroll: true }); this.renderList();
  }
  private readerFeedback(parent: Element, bundle: Bundle) {
    const feedback = parent.createDiv({ cls: 'qrs-feedback', attr: { role: 'status' } });
    feedback.createSpan({ text: this.message });
    if (this.articleFailed) {
      const retry = feedback.createEl('button', { text: t('common.retry'), cls: 'qrs-feedback-retry' });
      retry.onclick = () => { if (this.bundle?.entry.id === bundle.entry.id) void this.openArticle(bundle.entry, undefined, this.requestedMode); };
    }
    return feedback;
  }
  private noteCurrent() {
    const bundle = this.bundle; if (!bundle) return;
    this.run(async () => {
      this.plugin.remember(bundle);
      const result = await this.plugin.noteArticle(bundle.entry, '', this.mode);
      new Notice(result.added ? t('notice.addedToDailyNote') : t('notice.alreadyInDailyNote'));
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
    const load = async (img: HTMLImageElement, url: string, holder: HTMLElement, refresh = false) => {
      holder.querySelector('button')?.remove();
      holder.addClass('is-loading');
      const failed = () => {
        if (this.closed || version !== this.renderVersion) return;
        holder.removeClass('is-loading');
        holder.querySelector('button')?.remove();
        const button = holder.createEl('button', { text: t('notice.imageRetry'), cls: 'qrs-image-retry' });
        button.onclick = () => { void load(img, url, holder, true); };
      };
      try {
        const blob = await this.plugin.images.load(url, refresh);
        if (this.closed || version !== this.renderVersion) return;
        enableImageDrag(img, blob);
        const local = URL.createObjectURL(blob); this.blobUrls.push(local);
        img.onload = () => holder.removeClass('is-loading');
        img.onerror = failed; img.src = local;
      } catch { failed(); }
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
    this.toolbarTips?.hide();
    this.selectionCapture?.clear();
    const active = this.contentEl.ownerDocument.activeElement;
    const focusedAction = this.reader.contains(active) ? active?.getAttribute('data-qrs-action') || active?.getAttribute('data-qrs-tip') : null;
    const restoreFocus = active !== this.reader && this.reader.contains(active);
    const scroll = this.reader.scrollTop;
    const previous = keepContent ? this.reader.querySelector('.qrs-article') : null;
    if (!previous) { this.plugin.speech?.detach(this); stopMedia(this.reader); this.clearImages(); }
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
      empty.createEl('h2', { text: t('welcome.title') });
      empty.createEl('p', { cls: 'qrs-welcome-intro', text: t('welcome.intro') });
      const tips = [
        [t('welcome.tip1.title'), t('welcome.tip1.body')],
        [t('welcome.tip2.title'), t('welcome.tip2.body')],
        [t('welcome.tip3.title'), t('welcome.tip3.body')],
        [t('welcome.tip4.title'), t('welcome.tip4.body')],
        [t('welcome.tip5.title'), t('welcome.tip5.body')],
      ];
      if (this.welcomeSource !== this.source || this.welcomeTip < 0) { this.welcomeTip = (this.welcomeTip + 1) % tips.length; this.welcomeSource = this.source; }
      const tip = empty.createDiv('qrs-welcome-tip');
      const showTip = () => { tip.empty(); const [title, copy] = tips[this.welcomeTip]; tip.createDiv({ cls: 'qrs-welcome-index', text: `${String(this.welcomeTip + 1).padStart(2, '0')} / ${String(tips.length).padStart(2, '0')}   ${t('welcome.note')}` }); tip.createEl('h3', { text: title }); tip.createEl('p', { text: copy }); };
      showTip();
      empty.createEl('button', { cls: 'qrs-welcome-next', text: t('welcome.next') }).onclick = () => { this.welcomeTip = (this.welcomeTip + 1) % tips.length; showTip(); };
      if (!Platform.isMobileApp) {
        const keys = empty.createDiv('qrs-welcome-keys');
        for (const [key, label] of [['J / K', t('welcome.key.nextPrev')], ['[', t('welcome.key.collapse')], ['F', t('welcome.key.favorite')], ['M', t('welcome.key.later')], ['/', t('welcome.key.search')]]) { const item = keys.createSpan(); item.createEl('kbd', { text: key }); item.createSpan({ text: label }); }
      }
      this.plugin.refreshArticleOutline(this);
      return;
    }
    const head = this.reader.createDiv('qrs-reader-head');
    const toolbar = head.createDiv('qrs-reader-toolbar');
    this.addIconButton(toolbar, this.focused ? 'panel-left-open' : 'panel-left-close', t('reader.toggleList'), () => this.toggleFocus());
    const modeId = `${this.appearanceId}-mode`; toolbar.createEl('label', { cls: 'qrs-visually-hidden', text: t('reader.readingVersion'), attr: { for: modeId } });
    const select = toolbar.createEl('select', { cls: 'qrs-mode-select', attr: { id: modeId, 'data-qrs-field': t('reader.readingVersion') } });
    const podcast = !!bundle.entry.podcastSlug || this.plugin.state.sources.some(source => source.id === bundle.entry.sourceId && source.category === 'podcast');
    const fullTranscript = !!bundle.entry.podcastSlug || ['allin', 'joerogan'].includes(bundle.entry.sourceId) || bundle.entry.sourceId.startsWith('podscribe-');
    for (const mode of modeSchema.options.filter(mode => (bundle.entry.origin !== 'local' && bundle.entry.origin !== 'vault' && !bundle.entry.podcastSlug) || mode === 'original')) select.createEl('option', { value: mode, text: podcast && mode === 'original' ? (fullTranscript ? t('mode.transcript') : t('mode.podcastOriginal')) : modeLabel(mode) });
    select.disabled = bundle.entry.origin === 'local' || bundle.entry.origin === 'vault' || !!bundle.entry.podcastSlug;
    select.value = this.mode; select.onchange = () => { this.mode = this.requestedMode = modeSchema.parse(select.value); this.renderReader(); };
    const nav = toolbar.createDiv('qrs-reader-nav');
    this.addIconButton(nav, 'chevron-up', t('reader.prevArticle'), () => this.navigate(-1));
    this.addIconButton(nav, 'chevron-down', t('reader.nextArticle'), () => this.navigate(1));
    const actions = toolbar.createDiv('qrs-actions');
    const outlineButton = this.addIconButton(actions, 'list-tree', t('outline.title'), () => this.run(() => this.plugin.toggleArticleOutline(this)));
    outlineButton.dataset.qrsOutline = ''; outlineButton.dataset.qrsAction = 'outline';
    this.refreshOutlineButton();
    const appearance = this.addIconButton(actions, 'type', t('reader.readingSettings'), () => { this.appearanceOpen = !this.appearanceOpen; this.renderReader(true); });
    appearance.dataset.qrsAppearance = ''; appearance.dataset.qrsAction = 'reading-settings';
    appearance.setAttribute('aria-controls', this.appearanceId); appearance.setAttribute('aria-expanded', String(this.appearanceOpen));
    this.plugin.speech.attach(this, actions);
    const favoriteId = this.relatedContentIds(bundle.entry).find(id => this.plugin.state.favorites[id]);
    const favorite = !!favoriteId;
    const bookmark = this.addIconButton(actions, 'bookmark', favorite ? t('reader.unfavorite') : t('reader.favorite'), () => this.run(async () => {
      if (favoriteId) for (const id of this.relatedContentIds(bundle.entry)) delete this.plugin.state.favorites[id];
      else this.plugin.state.favorites[bundle.entry.id] = bundle;
      await this.plugin.persist(); this.renderReader(true); this.renderList();
    }));
    bookmark.setAttribute('aria-pressed', String(favorite)); bookmark.toggleClass('is-bookmarked', favorite);
    bookmark.dataset.qrsTip = 'favorite';
    const relatedIds = this.relatedContentIds(bundle.entry);
    const read = relatedIds.some(id => this.plugin.state.readIds.includes(id));
    const readButton = this.addIconButton(actions, read ? 'circle-check' : 'circle', read ? t('reader.markUnread') : t('reader.markRead'), () => this.run(async () => {
      const ids = this.plugin.state.readIds.filter(id => !relatedIds.includes(id));
      this.plugin.state.readIds = read ? ids : [...ids, bundle.entry.id].slice(-5000);
      await this.plugin.persist(); this.renderReader(true); this.renderList();
    }));
    readButton.setAttribute('aria-pressed', String(read));
    readButton.dataset.qrsTip = 'read';
    // Article-file actions live in More; the toolbar has one unambiguous Daily Note action.
    const mode = this.mode, savedNote = this.savedNote(bundle, mode);
    this.addIconButton(actions, 'notebook-pen', t('reader.noteToDaily'), () => this.noteCurrent()).dataset.qrsTip = 'daily-note';
    let moreSelection: Range | undefined;
    const more = this.addIconButton(actions, 'ellipsis', t('reader.moreActions'), () => {
      if (this.contentEl.win.getComputedStyle(actions).getPropertyValue('--qrs-actions-compact').trim() === '1') this.plugin.speech.openCompactMenu(this, more, moreSelection);
      else this.openArticleActions?.(more);
      moreSelection = undefined;
    });
    this.openArticleActions = anchor => {
      const menu = new Menu().setUseNativeMenu(false); const link = safeUrl(bundle.entry.link || '');
      if (bundle.entry.origin === 'vault' && bundle.entry.markdownPath) menu.addItem(item => item.setTitle(t('reader.openSourceFile')).setIcon('file-text').onClick(() => {
        void this.app.workspace.openLinkText(bundle.entry.markdownPath!, '', true);
      }));
      if (link) menu.addItem(item => item.setTitle(t('reader.openOriginal')).setIcon('external-link').onClick(() => { this.contentEl.win.open(link, '_blank', 'noopener,noreferrer'); }));
      const video = safeUrl(bundle.entry.videoUrl || '');
      if (video && videoEmbedUrl(video)) menu.addItem(item => item.setTitle(t('reader.openVideo')).setIcon('video').onClick(() => { this.contentEl.win.open(video, '_blank', 'noopener,noreferrer'); }));
      menu.addItem(item => item.setTitle(t('reader.reloadArticle')).setIcon('refresh-cw').onClick(() => this.run(async () => {
        try { await this.plugin.syncDeletedArticles(); } catch { /* Preserve cached reading when the service is offline. */ }
        if (!this.plugin.articleDeleted(bundle.entry)) await this.openArticle(bundle.entry);
      })));
      if (bundle.entry.origin !== 'vault') menu.addSeparator().addItem(item => item.setTitle(t('localDelete.action')).setIcon('trash-2').onClick(() => this.deleteLocal(bundle.entry)));
      if (this.plugin.canDeleteArticle(bundle.entry)) menu.addItem(item => item.setTitle(t('moderation.move')).setIcon('folder-input').onClick(() => this.plugin.openMoveArticle(bundle.entry)));
      if (this.plugin.canDeleteArticle(bundle.entry)) menu.addSeparator().addItem(item => item.setTitle(t('moderation.delete')).setIcon('trash-2').onClick(() => this.plugin.confirmDeleteArticle(bundle.entry)));
      menu.addSeparator();
      menu.addItem(item => item.setTitle(savedNote ? t('reader.openSavedNote') : t('reader.saveNote')).setIcon(savedNote ? 'file-check' : 'file-plus').onClick(() => {
        if (savedNote) void this.app.workspace.getLeaf('tab').openFile(savedNote); else this.saveNote(bundle, mode);
      }));
      if (savedNote) menu.addItem(item => item.setTitle(t('reader.saveAnotherNote')).setIcon('file-plus').onClick(() => this.saveNote(bundle, mode)));
      menu.addItem(item => item.setTitle(t('reader.saveNoteTo')).setIcon('folder').onClick(() => {
        new NoteLocationModal(this.app, this.plugin.state.settings.articleFolder, exportBaseName(bundle, mode),
          (folder, remember) => this.saveNoteAt(bundle, mode, folder, remember)).open();
      }));
      if (Platform.isDesktopApp) {
        menu.addItem(item => item.setTitle(t('reader.exportPdf')).setIcon('file-down').onClick(() => this.run(async () => {
          const article = this.reader.querySelector<HTMLElement>('.qrs-article');
          if (!article || this.bundle?.entry.id !== bundle.entry.id || this.mode !== mode) throw new Error(t('error.articleSwitched'));
          const result = await saveArticlePdf(bundle, mode, article, this.plugin.images, this.plugin.state.settings);
          if (!result) return;
          await this.plugin.persist();
          new Notice(result.missingImages ? t('notice.pdfSavedWithMissing', { n: result.missingImages }) : t('notice.pdfSaved'));
        })));
      }
      menu.addItem(item => item.setTitle(t('reader.pickChannel')).setIcon('rss').onClick(() => this.pickChannel()));
      const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
    };
    more.dataset.qrsArticleMore = 'true';
    more.onpointerdown = () => { moreSelection = articleSelection(this.speechContext()?.prose); };
    if (focusedAction) Array.from(actions.querySelectorAll<HTMLElement>('[data-qrs-action],[data-qrs-tip]')).find(button => (button.dataset.qrsAction || button.dataset.qrsTip) === focusedAction)?.focus({ preventScroll: true });
    if (this.appearanceOpen) this.renderAppearanceSettings(toolbar);
    if (previous) {
      previous.querySelector('.qrs-feedback')?.remove();
      if (this.message) {
        const feedback = this.readerFeedback(previous, bundle);
        previous.querySelector('h1')?.after(feedback);
      }
      this.reader.append(previous); this.reader.scrollTop = scroll; this.restoreOffsets(); this.plugin.refreshArticleOutline(this); return;
    }
    const article = this.reader.createEl('article', { cls: 'qrs-article' });
    const title = article.createEl('h1');
    const originalUrl = safeUrl(bundle.entry.link || '');
    if (bundle.entry.origin === 'vault' && bundle.entry.markdownPath) {
      const link = title.createEl('a', { text: titleOf(bundle.entry), href: '#', cls: 'qrs-title-link' });
      link.onclick = event => { event.preventDefault(); void this.app.workspace.openLinkText(bundle.entry.markdownPath!, '', true); };
    } else if (originalUrl) title.createEl('a', { text: titleOf(bundle.entry), href: originalUrl, cls: 'qrs-title-link', attr: { target: '_blank', rel: 'noopener noreferrer' } });
    else title.setText(titleOf(bundle.entry));
    if (originalTitleOf(bundle.entry)) {
      title.addClass('qrs-bilingual-title');
      article.createDiv({ cls: 'qrs-article-original-title', text: originalTitleOf(bundle.entry), attr: { lang: 'en' } });
    }
    if (podcast) {
      const episode = bundle.entry;
      const date = episode.publishedTs ? new Date(episode.publishedTs).toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' }) : relativeTime(episode.publishedRelative || '');
      const facts = [date,
        episode.podcastViews != null ? t('reader.originalViews', { n: episode.podcastViews.toLocaleString() }) : '',
        episode.podcastDurationSeconds ? t('reader.duration', { n: Math.round(episode.podcastDurationSeconds / 60) }) : '',
        episode.podcastWordCount ? t('reader.words', { n: episode.podcastWordCount.toLocaleString() }) : ''].filter(Boolean);
      if (facts.length) article.createDiv({ cls: 'qrs-podcast-meta', text: facts.join(' · ') });
    }
    const original = safeUrl(bundle.entry.link || '');
    if (original && wechatArticleKey(original)) {
      title.addClass('qrs-wechat-title');
      const notice = article.createDiv('qrs-wechat-source');
      notice.createSpan({ text: t('reader.wechatNotice') });
      notice.createEl('a', { text: t('reader.wechatOriginal'), href: original, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    }
    if (this.message) this.readerFeedback(article, bundle);
    if (!this.articleLoading) renderMedia(article, bundle.entry);
    try {
      if (bundle.entry.origin === 'vault' && bundle.entry.markdown != null) {
        const prose = article.createDiv('qrs-prose');
        this.markdownComponent = new Component(); this.markdownComponent.load();
        void MarkdownRenderer.render(this.app, bundle.entry.markdown, prose, bundle.entry.markdownPath || '', this.markdownComponent)
          .then(async () => {
            if (this.closed || !this.reader.contains(prose)) return;
            await prepareMarkdownImageDrags(this.app, this.plugin.images, prose, bundle.entry.markdownPath || '');
            if (!this.closed && this.reader.contains(prose)) this.plugin.refreshArticleOutline(this);
          })
          .catch(() => {
            if (this.closed || !this.reader.contains(prose)) return;
            prose.setText(t('reader.markdownFailed')); this.plugin.refreshArticleOutline(this);
          });
      } else {
      const fragment = articleFragment(bundle, this.mode, article.ownerDocument, this.plugin.state.settings.remoteImages);
      if (fragment) { this.prepareImages(fragment); article.createDiv('qrs-prose').append(fragment); }
      else if (!this.message || this.articleLoading) article.createDiv({ cls: 'qrs-empty', text: this.articleLoading ? t('reader.loadingContent') : t('reader.noContent', { mode: podcast && this.mode === 'original' ? (fullTranscript ? t('mode.transcript') : t('mode.podcastOriginal')) : modeLabel(this.mode) }) });
      }
    } catch { article.createDiv({ cls: 'qrs-empty', text: t('reader.renderFailed') }); }
    this.reader.scrollTop = scroll; this.restoreOffsets();
    this.plugin.refreshArticleOutline(this);
    notifyContextChanged(this.app, this.plugin.manifest.id);
  }
  outlineContext(): OutlineContext | null {
    if (!this.bundle || this.closed) return null;
    return { title: titleOf(this.bundle.entry), loading: this.articleLoading,
      prose: this.reader.querySelector<HTMLElement>('.qrs-prose'), scroller: this.reader,
      beforeJump: () => this.stopRestoring() };
  }
  refreshOutlineButton() {
    this.reader?.querySelector('[data-qrs-outline]')?.setAttribute('aria-pressed', String(this.plugin.outlineOpen(this)));
  }
  /** The article as Qiaomu Agent should see it, or null when nothing is open. */
  speechContext() {
    if (!this.bundle || this.closed) return null;
    return { id: this.bundle.entry.id, mode: this.mode, prose: this.reader?.querySelector<HTMLElement>('.qrs-prose') ?? null, loading: this.articleLoading };
  }
  agentSnapshot(): ContextSnapshot | null {
    if (!this.bundle || this.closed) return null;
    return articleSnapshot(this.plugin.manifest.id, { bundle: this.bundle, mode: this.mode, prose: this.reader?.querySelector<HTMLElement>('.qrs-prose') ?? null });
  }
  private renderAppearanceSettings(anchor: HTMLElement) {
    const settings = this.plugin.state.settings;
    const headingId = `${this.appearanceId}-heading`;
    const panel = anchor.createEl('section', { cls: 'qrs-reading-settings', attr: { id: this.appearanceId, 'aria-labelledby': headingId } });
    const header = panel.createDiv('qrs-reading-settings-head'); header.createEl('strong', { text: t('reader.readingSettings'), attr: { id: headingId } });
    const fields = panel.createDiv('qrs-reading-settings-fields');
    const row = (label: string) => { const el = fields.createEl('label', { cls: 'qrs-reading-setting' }); el.createSpan({ text: label }); return el; };
    const themeRow = row(t('appearance.theme'));
    const theme = themeRow.createEl('select', { attr: { 'data-qrs-reading-theme': '' } });
    for (const value of readingThemeSchema.options) theme.createEl('option', { value, text: t(`appearance.theme.${value}`) });
    theme.value = settings.readingTheme;
    theme.onchange = () => { settings.readingTheme = readingThemeSchema.parse(theme.value); this.plugin.refreshReadingTheme(); this.run(() => this.plugin.persist()); };
    const fontRow = row(t('appearance.font'));
    const font = fontRow.createEl('select', { attr: { 'data-qrs-field': t('appearance.font') } });
    for (const choice of selectableFonts.concat(readingFonts.filter(f => f.id === settings.fontFamily && !selectableFonts.includes(f)))) font.createEl('option', { value: choice.id, text: fontName(choice.id) });
    font.value = settings.fontFamily;
    const customRow = row(t('appearance.customFont'));
    const custom = customRow.createEl('input', { type: 'text', value: settings.customFont, placeholder: t('appearance.customPlaceholder') });
    customRow.hidden = settings.fontFamily !== 'custom';
    custom.oninput = () => { settings.customFont = custom.value.slice(0, 200); this.applyAppearance(); this.run(() => this.plugin.persist()); };
    const sizeRow = row(t('appearance.size')); const sizeValue = sizeRow.createEl('output', { text: `${settings.fontSize} px` });
    const size = sizeRow.createEl('input', { type: 'range', value: String(settings.fontSize), attr: { min: '14', max: '32', step: '1', 'data-qrs-field': t('appearance.size') } });
    const heightRow = row(t('appearance.lineHeight')); const heightValue = heightRow.createEl('output', { text: t('settings.times', { n: settings.lineHeight.toFixed(1) }) });
    const height = heightRow.createEl('input', { type: 'range', value: String(settings.lineHeight), attr: { min: '1.5', max: '2.4', step: '0.1', 'data-qrs-field': t('appearance.lineHeight') } });
    const widthRow = row(t('appearance.width'));
    const width = widthRow.createEl('select', { attr: { 'data-qrs-field': t('appearance.width') } });
    for (const [value, label] of [['28', t('appearance.width.compact')], ['36', t('appearance.width.normal')], ['44', t('appearance.width.relaxed')]] as const) width.createEl('option', { value, text: label });
    width.value = String(settings.lineWidth);
    const update = () => { sizeValue.setText(`${settings.fontSize} px`); heightValue.setText(t('settings.times', { n: settings.lineHeight.toFixed(1) })); this.applyAppearance(); };
    font.onchange = () => { settings.fontFamily = readingFontSchema.parse(font.value); customRow.hidden = settings.fontFamily !== 'custom'; update(); this.run(() => this.plugin.persist()); };
    size.oninput = () => { settings.fontSize = Number(size.value); update(); this.run(() => this.plugin.persist()); }; size.onchange = () => this.run(() => this.plugin.persist());
    height.oninput = () => { settings.lineHeight = Number(height.value); update(); this.run(() => this.plugin.persist()); }; height.onchange = () => this.run(() => this.plugin.persist());
    width.onchange = () => { settings.lineWidth = Number(width.value) as 28 | 36 | 44; update(); this.run(() => this.plugin.persist()); };
    panel.onkeydown = event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.appearanceOpen = false; this.renderReader(true); } };
  }
}
