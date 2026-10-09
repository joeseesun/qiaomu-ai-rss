import { CuratedSourcePicker } from './curated-source-picker';
import { applyCuratedPicks } from './curated-sources';
import { watchPaneDividers } from "./pane-dividers";
import { LabSettingsModal } from './lab-settings';
import { applyDeletedEntries, remoteEntry } from './moderation';
import { CollectionClient, syncCollectionTitles, type CollectionItem } from './collection';
import { migrateLibrary, moveSources, registerSource } from './personal-library';
import { EditorView } from '@codemirror/view';
import { MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type App, type SettingDefinitionItem, type SettingGroupItem } from 'obsidian';
import { requestUrl } from 'obsidian';
import { RssApi } from './api';
import { folderPath, initialState, renameArticleNotes, modeLabel, modeSchema, readingFontSchema, readingThemeSchema, splitContentCache, attachContentCache, stripFeedBodies, type Bundle, type Entry, type Mode, type State } from './model';
import { cleanCaptureMarkers, repairArticleLinks, appendDailyNoteLink, captureMoment, dailyNotePath, readDailyNoteSettings, renderDailyNoteTemplate } from './daily-note';
import { ReaderView, VIEW_TYPE } from './view';
import { contextProvider } from './agent-bridge';
import { createHomeProvider } from './home';
import { notifyHomeChanged } from './qiaomu-home';
import { vaultSourceId, VaultFolderPicker, VaultSources } from './vault-source';
import { fontName, readingFonts, selectableFonts, ReadingFonts } from './fonts';
import { registerImageDrops } from './image-drag';
import { LocalImages } from './images';
import { Subscriptions } from './subscriptions';
import { SourceHealthModal } from './source-health';
import { RETIRED_VIEW_TYPES, RetiredView, SubscriptionCenter, type CenterTab } from './subscription-center';
import { ConfirmAction } from './subscription-ui';
import { t } from './i18n';
import { articleFolderPath } from './vault-export';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default class QiaomuRssPlugin extends Plugin {
  fonts = new ReadingFonts();
  vaultSources = new VaultSources(this.app);
  state: State = initialState(null);
  images!: LocalImages;
  subscriptions!: Subscriptions;
  /** Shares the open article with Qiaomu Agent; see qiaomu-context.ts. */
  qiaomuContext = contextProvider(leaf => leaf.view instanceof ReaderView ? leaf.view.agentSnapshot() : null);
  /** Shows the newest unread articles on Qiaomu Home; see qiaomu-home.ts. */
  qiaomuHome = createHomeProvider(this);
  private labSettings?: LabSettingsModal;
  private collectionVerified = '';
  private adminSession?: { token: string; expiresAt: number; name: string; baseUrl: string };
  private collectionBusy = false;
  private collectionSubmitting = new Set<string>();
  private collectionStopped = false;
  private lastNote: TFile | null = null;
  private libraryEdits: Promise<void> = Promise.resolve();
  private saving: Promise<void> = Promise.resolve();
  private apiClient?: RssApi;
  private apiBase = '';
  private dailyNoteWrite: Promise<unknown> = Promise.resolve();
  async onload() {
    watchPaneDividers(this);
    this.lastNote = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      if (leaf?.view instanceof MarkdownView && leaf.view.file) {
        this.lastNote = leaf.view.file; this.cleanNoteMarkers(leaf.view.file);
      }
    }));
    const data: unknown = await this.loadData();
    try { this.state = initialState(data); }
    catch { new Notice(t('notice.dataUnreadable')); throw new Error('Incompatible RSS data'); }
    applyCuratedPicks(this.state);
    await this.loadContentCache();
    this.adminSession = this.state.collectionAdminSession ?? undefined;
    if (data && typeof data === 'object' && !('libraryVersion' in data)) {
      const backup = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data-before-library-v1.json`;
      if (!await this.app.vault.adapter.exists(backup)) await this.app.vault.adapter.write(backup, JSON.stringify(data));
      await this.persist();
    }
    this.images = new LocalImages(this.app.vault, `${this.app.vault.configDir}/plugins/${this.manifest.id}/image-cache`);
    registerImageDrops(this);
    this.subscriptions = new Subscriptions(() => this.state, () => this.persist().then(() => { this.refreshDiscovery(); this.refreshPersonalViews(); }), undefined, () => this.markBodiesDirty());
    this.addCommand({ id: 'manage-subscriptions', name: t('cmd.manageSubscriptions'), callback: () => this.manageSubscriptions() });
    this.registerView(VIEW_TYPE, leaf => new ReaderView(leaf, this));
    for (const type of RETIRED_VIEW_TYPES) this.registerView(type, leaf => new RetiredView(leaf, type));
    const retire = () => { for (const type of RETIRED_VIEW_TYPES) for (const leaf of this.app.workspace.getLeavesOfType(type)) leaf.detach(); };
    this.app.workspace.onLayoutReady(() => { retire(); window.setTimeout(retire, 500); });
    this.addCommand({ id: 'explore-subscriptions', name: t('cmd.exploreSubscriptions'), callback: () => { void this.openDiscovery(); } });
    this.addCommand({ id: 'pick-qiaomu-sources', name: t('pick.title'), callback: () => this.pickCuratedSources() });
    this.addRibbonIcon('rss', t('cmd.openReader'), () => { void this.openReader(); });
    this.addCommand({ id: 'open-reader', name: t('cmd.openReader'), callback: () => { void this.openReader(); } });
    this.addCommand({ id: 'source-health', name: t('cmd.sourceHealth'), callback: () => this.openSourceHealth() });
    this.registerInterval(window.setInterval(() => { void this.checkCollectionJobs(); }, 15000));
    void this.checkCollectionJobs();
    this.addSettingTab(new RssSettings(this.app, this));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (renameArticleNotes(this.state.articleNotes, oldPath, file.path)) void this.persist();
      if (!this.state.settings.markdownFolders.some(path => path === oldPath || path.startsWith(oldPath + '/'))) return;
      void this.editLibrary(() => {
        this.state.settings.markdownFolders = this.state.settings.markdownFolders.map(path => {
          if (path !== oldPath && !path.startsWith(oldPath + '/')) return path;
          const next = file.path + path.slice(oldPath.length), oldId = vaultSourceId(path), nextId = vaultSourceId(next);
          if (this.state.sourceMeta[oldId]) { this.state.sourceMeta[nextId] = this.state.sourceMeta[oldId]; delete this.state.sourceMeta[oldId]; }
          if (this.state.settings.lastSource === oldId) this.state.settings.lastSource = nextId;
          return next;
        });
      }).catch(() => new Notice(t('notice.subscriptionPathFailed')));
    }));
    this.registerEvent(this.app.workspace.on('file-open', file => { if (file?.extension === 'md') this.cleanNoteMarkers(file); }));
    this.app.workspace.onLayoutReady(() => {
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        if (leaf.view instanceof MarkdownView && leaf.view.file) this.cleanNoteMarkers(leaf.view.file);
      }
    });
    this.registerMarkdownPostProcessor(element => {
      for (const link of element.querySelectorAll<HTMLAnchorElement>('a[href^="obsidian://qiaomu-ai-rss?"]')) {
        link.setAttribute('href', repairArticleLinks(link.getAttribute('href') || ''));
      }
    });
    // Handle links inside Obsidian directly, including Live Preview links.
    const registerLinks = (doc: Document) => this.registerDomEvent(doc, 'click', event => {
      const target = event.target;
      if (!(target instanceof doc.defaultView!.Element)) return;
      const link = target.closest('a[href]');
      let href = link?.getAttribute('href');
      const editorLink = target.closest<HTMLElement>('.cm-link');
      if (!href && editorLink) {
        const cm = EditorView.findFromDOM(editorLink);
        if (cm) {
          const position = cm.posAtDOM(editorLink), line = cm.state.doc.lineAt(position);
          for (const match of line.text.matchAll(/\[[^\n]*?\]\(<(obsidian:\/\/qiaomu-ai-rss\?[^>]+)>\)/g)) {
            if (position >= line.from + match.index && position <= line.from + match.index + match[0].length) { href = match[1]; break; }
          }
        }
      }
      if (!href?.startsWith('obsidian://qiaomu-ai-rss?')) return;
      const url = new URL(repairArticleLinks(href));
      if (url.searchParams.get('vault') !== this.app.vault.getName()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void this.openSavedArticle(url.searchParams.get('article') || '', url.searchParams.get('mode') || 'original')
        .catch(() => new Notice(t('notice.localCopyMissing')));
    }, { capture: true });
    registerLinks(document);
    this.registerEvent(this.app.workspace.on('window-open', (_window, win) => registerLinks(win.document)));
    this.registerObsidianProtocolHandler('qiaomu-ai-rss', params => {
      void this.openSavedArticle(params.article || '', params.mode || 'original').catch(() => new Notice(t('notice.localCopyMissingShort')));
    });
  }
  onunload() { this.collectionStopped = true; this.labSettings?.close(); this.center?.close(); this.fonts.dispose(); }
  api(): RssApi {
    const base = this.state.settings.baseUrl;
    if (this.apiClient && this.apiBase === base) return this.apiClient;
    this.apiBase = base;
    this.apiClient = new RssApi(base, async url => {
      const response = await requestUrl({ url, method: 'GET', headers: { Accept: 'application/json' }, throw: false });
      return { status: response.status, text: response.text };
    });
    return this.apiClient;
  }
  private collectionClient(baseUrl = this.state.settings.baseUrl, invite = this.state.settings.labInviteCode) {
    this.state.collectionIdentity ??= { id: crypto.randomUUID(), key: crypto.randomUUID() + crypto.randomUUID() };
    return new CollectionClient(baseUrl, invite, async options => {
      const response = await requestUrl({ ...options, throw: false });
      return { status: response.status, text: response.text };
    }, this.state.collectionIdentity);
  }
  async verifyCollectionInvite(code: string) {
    const invite = code.trim();
    await this.collectionClient(this.state.settings.baseUrl, invite).verify(this.state.collectionJobs.filter(job => job.baseUrl === this.state.settings.baseUrl).map(job => job.id));
    const previous = { code: this.state.settings.labInviteCode, verified: this.state.settings.labInviteVerified };
    this.state.settings.labInviteCode = invite; this.state.settings.labInviteVerified = true;
    this.collectionVerified = this.state.settings.baseUrl + '|' + invite;
    try { await this.persist(); } catch (error) { this.state.settings.labInviteCode = previous.code; this.state.settings.labInviteVerified = previous.verified; this.collectionVerified = ''; throw error; }
    this.refreshPersonalViews();
  }
  private async ensureCollectionVerified() {
    if (this.collectionVerified !== this.state.settings.baseUrl + '|' + this.state.settings.labInviteCode) await this.verifyCollectionInvite(this.state.settings.labInviteCode);
  }
  collectionAdminAvailable() { return !!this.adminSession && this.adminSession.expiresAt > Date.now() && this.adminSession.baseUrl === this.state.settings.baseUrl; }
  collectionAdminName() { return this.collectionAdminAvailable() ? this.adminSession!.name : ''; }
  async verifyCollectionAdmin(email: string, password: string) {
    const session = await this.collectionClient().adminLogin(email.trim(), password);
    this.adminSession = { ...session, baseUrl: this.state.settings.baseUrl };
    this.state.collectionAdminSession = this.adminSession; await this.persist(); this.refreshPersonalViews();
  }
  async logoutCollectionAdmin() {
    const session = this.adminSession; this.adminSession = undefined; this.state.collectionAdminSession = null; await this.persist(); this.refreshPersonalViews();
    if (session) await this.collectionClient(session.baseUrl).logout(session.token);
  }
  async collectionPage(all: boolean, cursor = '') {
    if (all) {
      if (!this.collectionAdminAvailable()) throw new Error(t('lab.adminDenied'));
      try { return await this.collectionClient().listAll(this.adminSession!.token, cursor); }
      catch (error) { if (error instanceof Error && error.message === t('lab.adminDenied')) { this.adminSession = undefined; this.state.collectionAdminSession = null; await this.persist(); this.refreshPersonalViews(); } throw error; }
    }
    await this.ensureCollectionVerified();
    const baseUrl = this.state.settings.baseUrl, page = await this.collectionClient(baseUrl).list(cursor);
    if (syncCollectionTitles(this.state.collectionJobs, page.jobs, baseUrl)) await this.persist();
    return page;
  }
  collectionLocalItems(): CollectionItem[] { return this.state.collectionJobs.filter(job => job.baseUrl === this.state.settings.baseUrl && (!job.entryId || !(this.state.deletedEntries[job.baseUrl] || []).includes(job.entryId))).map(job => ({ ...job })); }
  articleDeleted(entry: Entry) { return remoteEntry(entry) && (this.state.deletedEntries[this.state.settings.baseUrl] || []).includes(entry.id); }
  private async applyArticleDeletions(ids: string[], baseUrl: string) {
    applyDeletedEntries(this.state, ids, baseUrl);
    if (baseUrl === this.state.settings.baseUrl) for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ReaderView) leaf.view.removeDeletedArticles();
    await this.persist();
  }
  async syncDeletedArticles() {
    const state = this.state, baseUrl = state.settings.baseUrl;
    const entries = [...state.entries, ...Object.values(state.cache).map(b => b.entry), ...Object.values(state.favorites).map(b => b.entry), ...Object.values(state.savedArticles).map(b => b.entry)];
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ReaderView) entries.push(...leaf.view.moderationEntries());
    for (const [key, channel] of Object.entries(state.channelStates)) if (key.startsWith(JSON.stringify([baseUrl]).slice(0, -1) + ',')) entries.push(...channel.entries, ...(channel.bundle ? [channel.bundle.entry] : []));
    const ids = [...new Set([...entries.filter(remoteEntry).map(e => e.id), ...state.collectionJobs.filter(j => j.baseUrl === baseUrl && j.entryId).map(j => j.entryId!)])];
    const deleted: string[] = [];
    for (let start = 0; start < ids.length; start += 100) {
      const batch = ids.slice(start, start + 100), result = await this.api().deletedEntries(batch);
      deleted.push(...result.deletedIds.filter(id => batch.includes(id)));
    }
    if (state === this.state && baseUrl === this.state.settings.baseUrl && deleted.length) await this.applyArticleDeletions(deleted, baseUrl);
  }
  canDeleteArticle(entry: Entry) { return this.collectionAdminAvailable() && remoteEntry(entry) && !this.articleDeleted(entry); }
  confirmDeleteArticle(entry: Entry) {
    if (!this.canDeleteArticle(entry)) return;
    const baseUrl = this.state.settings.baseUrl, modal = new Modal(this.app);
    modal.modalEl.addClasses(['qrs-modal', 'qrs-lab-settings']); modal.setTitle(t('moderation.delete'));
    modal.contentEl.createEl('p', { text: entry.titleZh || entry.title });
    modal.contentEl.createEl('p', { text: t('moderation.confirm') });
    const error = modal.contentEl.createDiv('qrs-subscription-error');
    new Setting(modal.contentEl).addButton(button => button.setButtonText(t('common.cancel')).onClick(() => modal.close())).addButton(button => button.setButtonText(t('moderation.delete')).setCta().onClick(async () => {
      if (baseUrl !== this.state.settings.baseUrl || !this.canDeleteArticle(entry)) { error.setText(t('lab.adminDenied')); return; }
      button.setDisabled(true);
      try {
        const result = await this.collectionClient().deleteArticle(this.adminSession!.token, entry.id);
        await this.applyArticleDeletions([result.entryId], baseUrl); modal.close(); new Notice(t('moderation.deleted'));
      } catch (failure) {
        error.setText(failure instanceof Error ? failure.message : t('lab.unavailable'));
        if (failure instanceof Error && failure.message === t('lab.adminDenied')) { this.adminSession = undefined; this.state.collectionAdminSession = null; await this.persist(); this.refreshPersonalViews(); }
        button.setDisabled(false);
      }
    }));
    modal.open();
  }
  async openCollectionChannel(all = false) {
    await this.openReader(); const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view instanceof ReaderView) view.showPersonalSource(all ? '@collection-all' : '@collection');
  }
  openCollectionSettings(adminOnly = false) { this.labSettings?.close(); this.labSettings = new LabSettingsModal(this.app, this, adminOnly); this.labSettings.open(); return this.labSettings; }
  async openCollectionResult(baseUrl: string, id: string) {
    if (baseUrl !== this.state.settings.baseUrl) { window.open(`${baseUrl}/?entry=${encodeURIComponent(id)}`, '_blank', 'noopener'); return; }
    try { const result = await this.api().article(id); await this.openReader(); const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view; if (view instanceof ReaderView) view.showSavedArticle(result.bundle, 'rewrite'); } catch { new Notice(t('lab.unavailable')); }
  }
  async submitCollection(url: string) {
    if (!this.state.settings.labCollection || !this.state.settings.labInviteCode.trim()) {
      new Notice(t('lab.configure')); this.openSettings(); return;
    }
    const baseUrl = this.state.settings.baseUrl;
    const existing = this.state.collectionJobs.find(job => job.url === url && job.baseUrl === baseUrl && job.status !== 'failed');
    if (existing?.status === 'complete') { new Notice(t('lab.complete', { title: existing.title || url })); return; }
    if (this.collectionSubmitting.has(url)) return;
    this.collectionSubmitting.add(url);
    const job = existing || { id: crypto.randomUUID(), url, baseUrl, status: 'queued' as const, title: '', notified: false, createdAt: Date.now() };
    try {
      await this.ensureCollectionVerified();
      if (!existing) this.state.collectionJobs.push(job);
      await this.persist();
      const result = await this.collectionClient(baseUrl).submit(job.id, url);
      if (this.collectionStopped) return;
      Object.assign(job, result);
      await this.persist(); this.refreshPersonalViews();
      new Notice(t('lab.submitted'));
      await this.checkCollectionJobs();
    } catch (error) { new Notice(error instanceof Error ? error.message : t('lab.unavailable')); }
    finally { this.collectionSubmitting.delete(url); }
  }
  async checkCollectionJobs() {
    if (this.adminSession && !this.collectionAdminAvailable()) { this.adminSession = undefined; this.state.collectionAdminSession = null; await this.persist(); this.refreshPersonalViews(); }
    if (this.collectionBusy || this.collectionStopped || !this.state.settings.labCollection || !this.state.settings.labInviteCode.trim()) return;
    this.collectionBusy = true;
    try {
      await this.ensureCollectionVerified();
      for (const job of this.state.collectionJobs.filter(job => !job.notified)) {
        try {
          if (job.status === 'queued' || job.status === 'running') {
            const client = this.collectionClient(job.baseUrl);
            try { Object.assign(job, await client.status(job.id)); }
            catch (error) {
              if (!(error instanceof Error) || error.message !== 'COLLECTION_NOT_FOUND') throw error;
              Object.assign(job, await client.submit(job.id, job.url));
            }
          }
          if (this.collectionStopped) return;
          if (job.status === 'complete' || job.status === 'failed') {
            await this.persist();
            new Notice(t(job.status === 'complete' ? 'lab.complete' : 'lab.failed', { title: job.title || job.url }), 10000);
            job.notified = true;
          }
          await this.persist(); this.refreshPersonalViews();
        } catch { /* Keep the job for reconnection; do not produce repeated offline notices. */ }
      }
    } catch { /* Verification retries on reconnection without discarding saved tasks. */ } finally { this.collectionBusy = false; }
  }
  async openReader() {
    try {
      let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
      await leaf.loadIfDeferred();
      await this.app.workspace.revealLeaf(leaf);
    } catch { new Notice(t('notice.cannotOpenReader')); }
  }
  pickCuratedSources() { new CuratedSourcePicker(this).open(); }
  async saveCuratedSources(ids: string[] | null, sources = this.state.sources) {
    const previous = { ids: this.state.settings.pickedSourceIds, sources: this.state.sources, entries: this.state.entries,
      channels: structuredClone(this.state.channelStates), last: this.state.settings.lastSource };
    this.state.settings.pickedSourceIds = ids === null ? null : [...new Set(ids)];
    this.state.sources = sources;
    const last = this.state.settings.lastSource;
    if (ids !== null && sources.some(source => source.id === last) && !ids.includes(last) && !this.state.settings.followedPodcasts.includes(last)) this.state.settings.lastSource = '';
    try { await this.persist(); }
    catch (error) {
      this.state.settings.pickedSourceIds = previous.ids; this.state.sources = previous.sources;
      this.state.entries = previous.entries; this.state.channelStates = previous.channels; this.state.settings.lastSource = previous.last;
      throw error;
    }
    this.resetViews();
  }
  persist(): Promise<void> {
    applyCuratedPicks(this.state);
    if (this.state.deletedEntries[this.state.settings.baseUrl]?.length) applyDeletedEntries(this.state, [], this.state.settings.baseUrl);
    this.saving = this.saving.catch(() => undefined).then(() => this.saveSplit());
    // Read state, favorites and fetched entries all persist through here; Home coalesces bursts.
    void this.saving.then(() => notifyHomeChanged(this.app, this.manifest.id), () => undefined);
    return this.saving;
  }
  private cacheDirty = true;
  /** Entry bodies live in a rebuildable side file; only a body change may rewrite it. */
  markBodiesDirty() { this.cacheDirty = true; }
  private cachePath() { return `${this.app.vault.configDir}/plugins/${this.manifest.id}/content-cache.json`; }
  private async saveSplit(): Promise<void> {
    // data.json keeps config + metadata; entry bodies go to a rebuildable cache file,
    // rewritten only when bodies actually changed (scroll checkpoints must not rewrite megabytes).
    const { slim, cache } = splitContentCache(this.state);
    await this.saveData(slim);
    if (!this.cacheDirty) return;
    try { await this.app.vault.adapter.write(this.cachePath(), JSON.stringify(cache)); this.cacheDirty = false; }
    catch { /* The body cache is rebuildable from feeds; a failed write must not break state save. */ }
  }
  private async loadContentCache(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(this.cachePath()));
      if (parsed && typeof parsed === 'object') attachContentCache(this.state, parsed as Record<string, string>);
    } catch { /* No cache yet; bodies rehydrate on the next refresh. */ }
  }
  isLater(id: string): boolean { return this.state.readLater.includes(id); }
  async toggleLater(entry: Entry): Promise<boolean> {
    const queued = this.state.readLater.includes(entry.id);
    this.state.readLater = queued
      ? this.state.readLater.filter(id => id !== entry.id)
      : [...this.state.readLater, entry.id].slice(-200);
    await this.persist();
    return !queued;
  }
  openSourceHealth() {
    new SourceHealthModal(this.app, () => this.state, async id => {
      await this.subscriptions.remove(id);
      this.resetViews();
    }, () => this.resetViews()).open();
  }
  async storageStats() {
    const dir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const sizeOf = async (path: string): Promise<number> => { try { return (await this.app.vault.adapter.stat(path))?.size ?? 0; } catch { return 0; } };
    const [dataJson, cacheJson, images] = await Promise.all([
      sizeOf(`${dir}/data.json`), sizeOf(this.cachePath()), this.images.usage(),
    ]);
    return { dataJson, cacheJson, images };
  }
  async clearSourceBodies(id: string): Promise<{ freedBytes: number; freedCount: number }> {
    const feed = this.state.subscriptions.find(item => item.id === id);
    if (!feed) return { freedBytes: 0, freedCount: 0 };
    const result = stripFeedBodies(feed.entries);
    feed.entries = result.entries;
    this.markBodiesDirty();
    await this.persist();
    return result;
  }
  async clearAllBodies(): Promise<{ freedBytes: number; freedCount: number }> {
    let freedBytes = 0, freedCount = 0;
    for (const feed of this.state.subscriptions) {
      const result = stripFeedBodies(feed.entries);
      feed.entries = result.entries; freedBytes += result.freedBytes; freedCount += result.freedCount;
    }
    this.markBodiesDirty();
    await this.persist();
    return { freedBytes, freedCount };
  }
  async clearImages(): Promise<{ files: number; bytes: number }> { return this.images.clear(); }
  remember(bundle: Bundle) {
    if (this.articleDeleted(bundle.entry)) return;
    this.state.cache[bundle.entry.id] = bundle;
    const recent = Object.values(this.state.cache).sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, 40);
    this.state.cache = Object.fromEntries(recent.map(value => [value.entry.id, value]));
    if (this.state.favorites[bundle.entry.id]) this.state.favorites[bundle.entry.id] = bundle;
    if (bundle.entry.content) this.markBodiesDirty();
  }
  private async ensureFolder(path: string) {
    let current = '';
    for (const segment of path.split('/').slice(0, -1)) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try { await this.app.vault.createFolder(current); }
        catch (error) { if (!this.app.vault.getAbstractFileByPath(current)) throw error; }
      }
    }
  }
  async openSavedArticle(id: string, mode: string) {
    const bundle = this.state.savedArticles[id];
    if (!bundle) throw new Error('Missing saved article');
    await this.openReader();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (!(view instanceof ReaderView)) throw new Error('Reader unavailable');
    view.showSavedArticle(bundle, modeSchema.catch('original').parse(mode));
  }
  private cleanNoteMarkers(file: TFile) {
    this.dailyNoteWrite = this.dailyNoteWrite.catch(() => undefined).then(async () => {
      // file-open fires before the editor has finished loading its new buffer.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
      const view = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
        .find(view => view instanceof MarkdownView && view.file === file);
      if (view instanceof MarkdownView) {
        const content = view.editor.getValue();
        const matches = [...content.matchAll(/^[ \t]*<!-- qrs-article:[^\r\n]*?-->[ \t]*(?:\r?\n)?/gm)];
        for (const match of matches.reverse()) view.editor.replaceRange('', view.editor.offsetToPos(match.index), view.editor.offsetToPos(match.index + match[0].length));
        if (matches.length) await view.save();
      } else {
        const content = await this.app.vault.cachedRead(file);
        if (cleanCaptureMarkers(content) !== content) await this.app.vault.process(file, cleanCaptureMarkers);
      }
    }).catch(() => { new Notice(t('notice.excerptMarksNotCleared')); });
  }
  currentNote(): TFile | null {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? this.lastNote;
    return file && this.app.vault.getAbstractFileByPath(file.path) === file ? file : null;
  }
  async appendToDailyNote(entry: Entry, excerpt = '', mode: Mode = 'original', target?: TFile): Promise<{ file: TFile; added: boolean }> {
    const now = captureMoment();
    let result!: { file: TFile; added: boolean };
    const write = async () => {
      const id = `${entry.origin === 'local' ? 'local' : entry.origin === 'vault' ? 'vault' : this.state.settings.baseUrl}|${entry.id}`;
      const bundle = this.state.cache[entry.id] || this.state.favorites[entry.id] || { entry, rewrite: entry.rewrite || null, translation: null, fetchedAt: Date.now() };
      this.state.savedArticles[id] = bundle;
      await this.persist();
      const options = { vault: this.app.vault.getName(), article: id, mode, excerpt };
      if (target && this.app.vault.getAbstractFileByPath(target.path) !== target) throw new Error(t('error.targetNoteMissing'));
      const settings = target ? { folder: '', format: '', template: '' } : await readDailyNoteSettings(this.app.vault);
      const path = target?.path ?? dailyNotePath(settings, now);
      let existing = this.app.vault.getAbstractFileByPath(path);
      let added = false;
      if (existing && !(existing instanceof TFile)) throw new Error(t('error.dailyNotePathOccupied'));
      if (!(existing instanceof TFile)) {
        await this.ensureFolder(path);
        let template = '';
        if (settings.template) {
          const templateFile = this.app.vault.getAbstractFileByPath(`${settings.template}.md`);
          if (templateFile instanceof TFile) template = renderDailyNoteTemplate(await this.app.vault.read(templateFile), path.split('/').at(-1)?.replace(/\.md$/i, '') || '', now);
        }
        const next = appendDailyNoteLink(template, entry, options); added = next.added;
        try { existing = await this.app.vault.create(path, next.content); }
        catch (error) {
          existing = this.app.vault.getAbstractFileByPath(path);
          if (!(existing instanceof TFile)) throw error;
        }
      }
      if (!(existing instanceof TFile)) throw new Error(t('error.cannotCreateDailyNote'));
      if (!added) {
        const view = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
          .find(view => view instanceof MarkdownView && view.file === existing);
        if (view instanceof MarkdownView) {
          // Read the editor buffer so a pending autosave cannot erase a user's draft.
          const content = view.editor.getValue();
          const next = appendDailyNoteLink(content, entry, options); added = next.added;
          if (next.content !== content) {
            let start = 0, end = content.length, nextEnd = next.content.length;
            while (start < end && content[start] === next.content[start]) start++;
            while (end > start && nextEnd > start && content[end - 1] === next.content[nextEnd - 1]) { end--; nextEnd--; }
            view.editor.replaceRange(next.content.slice(start, nextEnd), view.editor.offsetToPos(start), view.editor.offsetToPos(end));
            await view.save();
          }
        } else {
          await this.app.vault.process(existing, content => {
            const next = appendDailyNoteLink(content, entry, options); added = next.added; return next.content;
          });
        }
      }
      result = { file: existing, added };
    };
    this.dailyNoteWrite = this.dailyNoteWrite.catch(() => undefined).then(write);
    await this.dailyNoteWrite;
    return result;
  }
  async noteArticle(entry: Entry, excerpt = '', mode: Mode = 'original'): Promise<{ file: TFile; added: boolean }> {
    const reader = this.app.workspace.getLeavesOfType(VIEW_TYPE).find(leaf => leaf === this.app.workspace.getMostRecentLeaf())
      ?? this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const result = await this.appendToDailyNote(entry, excerpt, mode);
    let leaf = this.app.workspace.getLeavesOfType('markdown').find(candidate => candidate.view instanceof MarkdownView && candidate.view.file?.path === result.file.path
      && (!reader || (candidate.parent !== reader.parent && candidate.getRoot() === reader.getRoot())));
    if (!leaf) leaf = reader ? this.app.workspace.createLeafBySplit(reader, 'vertical') : this.app.workspace.getLeaf('split', 'vertical');
    await leaf.openFile(result.file, { active: true }); await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof MarkdownView) {
      const lastLine = Math.max(0, leaf.view.editor.lineCount() - 1);
      leaf.view.editor.setCursor(lastLine, leaf.view.editor.getLine(lastLine).length); leaf.view.editor.focus();
    }
    return result;
  }
  openSettings(tabId = this.manifest.id) {
    const app = this.app as App & { setting: { open(): void; openTabById(id: string): void } };
    app.setting.open(); app.setting.openTabById(tabId);
  }
  editLibrary(edit: () => void): Promise<void> {
    const operation = this.libraryEdits.catch(() => undefined).then(() => this.applyLibraryEdit(edit));
    this.libraryEdits = operation; return operation;
  }
  private async applyLibraryEdit(edit: () => void) {
    const snapshot = structuredClone({ subscriptionGroups: this.state.subscriptionGroups, sourceMeta: this.state.sourceMeta, collapsedGroups: this.state.collapsedGroups, subscriptions: this.state.subscriptions, settings: this.state.settings });
    try { edit(); migrateLibrary(this.state); await this.persist(); }
    catch (e) { Object.assign(this.state, snapshot); throw e; }
    this.refreshPersonalViews(); this.refreshDiscovery();
  }
  refreshPersonalViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ReaderView) leaf.view.refreshPersonalSources();
  }
  async addLocalSource(path: string, groupId?: string) {
    await this.editLibrary(() => { if (!this.state.settings.markdownFolders.includes(path)) this.state.settings.markdownFolders.push(path); registerSource(this.state, `@vault:${path}`, ''); if (groupId !== undefined) moveSources(this.state, [`@vault:${path}`], groupId); });
  }
  async removePersonalSources(ids: string[]) {
    await this.editLibrary(() => {
      this.state.subscriptions = this.state.subscriptions.filter(s => !ids.includes(s.id));
      this.state.settings.followedPodcasts = this.state.settings.followedPodcasts.filter(id => !ids.includes(id));
      this.state.settings.markdownFolders = this.state.settings.markdownFolders.filter(path => !ids.includes(`@vault:${path}`));
      for (const id of ids) { delete this.state.sourceMeta[id]; delete this.state.settings.podcastNames[id]; }
      if (ids.includes(this.state.settings.lastSource)) this.state.settings.lastSource = '@local';
    });
  }
  async openPersonalSource(id: string) {
    this.center?.close();
    await this.openReader();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view instanceof ReaderView) view.showPersonalSource(id);
  }
  manageSubscriptions() { this.openCenter('library'); }
  openLibrary() { this.openCenter('library'); return Promise.resolve(); }
  openDiscovery() { this.openCenter('discover'); return Promise.resolve(); }
  center?: SubscriptionCenter;
  openCenter(tab: CenterTab) {
    if (this.center) { this.center.show(tab); return; }
    const center = this.center = new SubscriptionCenter(this.app, this, tab);
    const close = center.onClose.bind(center); center.onClose = () => { close(); if (this.center === center) this.center = undefined; };
    center.open();
  }
  refreshDiscovery() { this.center?.refresh(); }
  async activateSubscription(id: string) {
    if (!this.state.subscriptions.some(feed => feed.id === id)) return;
    this.state.settings.lastSource = id; await this.persist();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof ReaderView) leaf.view.showSubscription(id);
    }
  }
  async followPodcast(id: string, name?: string, activate = true) {
    const source = this.state.sources.find(item => item.id === id && item.category === 'podcast' && item.enabled !== false);
    if (!source) {
      if (!/^podscribe-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(t('error.invalidPodcastId'));
      const page = await this.api().podcastEpisodes(id);
      if (!page.entries.length) throw new Error(t('error.podcastNoEpisodes'));
    }
    if (!this.state.settings.followedPodcasts.includes(id)) this.state.settings.followedPodcasts.push(id);
    if (name) this.state.settings.podcastNames[id] = name.slice(0, 200);
    registerSource(this.state, id, '播客');
    if (activate) this.state.settings.lastSource = id;
    await this.persist(); this.refreshPersonalViews(); this.refreshDiscovery();
    if (!activate) return;
    await this.openReader();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view instanceof ReaderView) view.showRemoteSource(id);
    this.refreshDiscovery();
  }
  async unfollowPodcast(id: string) {
    this.state.settings.followedPodcasts = this.state.settings.followedPodcasts.filter(source => source !== id);
    delete this.state.sourceMeta[id];
    delete this.state.settings.podcastNames[id];
    if (this.state.settings.lastSource === id) this.state.settings.lastSource = '';
    await this.persist();
    this.resetViews(); this.refreshDiscovery();
  }
  async readSubscriptions() {
    await this.openReader();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view instanceof ReaderView) view.showSubscriptions();
  }
  async saveOpml(content: string): Promise<string> {
    const folder = folderPath(this.state.settings.folder); let current = '';
    for (const segment of folder.split('/')) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try { await this.app.vault.createFolder(current); }
        catch (error) { if (!this.app.vault.getAbstractFileByPath(current)) throw error; }
      }
    }
    const path = `${folder}/subscriptions-${Date.now()}.opml`;
    await this.app.vault.create(path, content); return path;
  }
  refreshReadingTheme() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof ReaderView) leaf.view.refreshReadingTheme();
    }
  }
  refreshPreferences() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof ReaderView) leaf.view.refreshPreferences();
    }
  }
  resetViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof ReaderView) leaf.view.reset();
    }
  }
}
class RssSettings extends PluginSettingTab {
  private section: 'reading' | 'sources' | 'excerpt' | 'lab' | 'about' = 'reading';
  constructor(app: App, private plugin: QiaomuRssPlugin) { super(app, plugin); this.containerEl.addClass('qrs-settings'); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.state.settings;
    const saveReading = async () => { this.plugin.refreshPreferences(); await this.plugin.persist(); };
    // A vault folder: type a path (saved when the field loses focus) or pick an existing folder.
    const folderSetting = (name: string, desc: string, key: 'articleFolder' | 'folder'): SettingGroupItem => ({ name, desc, render: setting => {
      const save = async (value: string) => {
        try { settings[key] = key === 'articleFolder' ? articleFolderPath(value) : folderPath(value); await this.plugin.persist(); }
        catch (error) { new Notice(error instanceof Error ? error.message : t('notice.cannotSaveSettings')); }
      };
      setting.addText(text => { text.setValue(settings[key]); text.inputEl.addEventListener('change', () => { void save(text.getValue()).then(() => text.setValue(settings[key])); }); });
      setting.addButton(button => button.setButtonText(t('settings.choose')).onClick(() => new VaultFolderPicker(this.app, folder => { if (key === 'articleFolder' || folder.path !== '/') void save(folder.path).then(() => this.update()); else new Notice(t('notice.pickVaultFolder')); }).open()));
    } });
    const definitions: SettingDefinitionItem[] = [
      { type: 'group', heading: t('settings.groupReading'), items: [
        { name: t('settings.selectionPopup.name'), desc: t('settings.selectionPopup.desc'), render: setting => {
          setting.addToggle(toggle => toggle.setValue(settings.selectionPopup).onChange(async value => { settings.selectionPopup = value; await saveReading(); }));
        } },
        { name: t('appearance.theme'), render: setting => { setting.addDropdown(drop => {
          for (const value of readingThemeSchema.options) drop.addOption(value, t(`appearance.theme.${value}`));
          drop.setValue(settings.readingTheme).onChange(async value => { settings.readingTheme = readingThemeSchema.parse(value); this.plugin.refreshReadingTheme(); await this.plugin.persist(); });
        }); } },
        { name: t('settings.fontFamily'), render: setting => { setting.addDropdown(drop => {
          for (const font of selectableFonts.concat(readingFonts.filter(f => f.id === settings.fontFamily && !selectableFonts.includes(f)))) drop.addOption(font.id, fontName(font.id));
          drop.setValue(settings.fontFamily).onChange(async value => { settings.fontFamily = readingFontSchema.parse(value); await saveReading(); this.update(); });
        }); } },
        { name: t('settings.customFont.name'), desc: t('settings.customFont.desc'), visible: () => settings.fontFamily === 'custom', render: setting => { setting.addText(text => text.setPlaceholder(t('settings.customFont.placeholder')).setValue(settings.customFont).onChange(async value => { settings.customFont = value.slice(0, 200); await saveReading(); })); } },
        { name: t('settings.fontSize'), render: setting => { setting.addDropdown(drop => {
          for (let size = 14; size <= 32; size++) drop.addOption(String(size), size + ' px');
          drop.setValue(String(settings.fontSize)).onChange(async value => { settings.fontSize = Number(value); await saveReading(); });
        }); } },
        { name: t('settings.lineHeight'), render: setting => { setting.addDropdown(drop => {
          for (let value = 15; value <= 24; value++) drop.addOption((value / 10).toFixed(1), t('settings.times', { n: (value / 10).toFixed(1) }));
          drop.setValue(settings.lineHeight.toFixed(1)).onChange(async value => { settings.lineHeight = Number(value); await saveReading(); });
        }); } },
        { name: t('settings.lineWidth'), render: setting => { setting.addDropdown(drop => {
          for (const width of [28, 36, 44]) drop.addOption(String(width), t('settings.chars', { n: width }));
          drop.setValue(String(settings.lineWidth)).onChange(async value => { settings.lineWidth = Number(value) as 28 | 36 | 44; await saveReading(); });
        }); } },
      ] },
      { type: 'group', heading: t('settings.groupVaultSources'), items: [
        { name: t('settings.vaultFolders.name'), desc: t('settings.vaultFolders.desc'), render: setting => {
          setting.addButton(button => button.setButtonText(t('settings.addFolder')).onClick(() => {
            new VaultFolderPicker(this.app, folder => {
              void this.plugin.addLocalSource(folder.path).then(() => this.update());
            }).open();
          }));
        } },
        ...settings.markdownFolders.map(folder => ({ name: folder === '/' ? t('settings.wholeVault') : folder, render: (setting: import('obsidian').Setting) => {
          setting.addButton(button => button.setButtonText(t('settings.remove')).onClick(async () => {
            await this.plugin.removePersonalSources([vaultSourceId(folder)]); this.update();
          }));
        } })),
      ] },
      { name: t('settings.subscriptions.name'), desc: t('settings.subscriptions.desc'), render: setting => {
        setting.addButton(button => button.setButtonText(t('settings.manageSubscriptions')).onClick(() => { (this.app as App & { setting: { close(): void } }).setting.close(); this.plugin.manageSubscriptions(); }));
        setting.addButton(button => button.setButtonText(t('settings.readingStats')).onClick(() => { (this.app as App & { setting: { close(): void } }).setting.close(); this.plugin.openSourceHealth(); }));
      } },
      { type: 'group', heading: t('settings.groupSaveExport'), items: [
        folderSetting(t('settings.articleFolder.name'), t('note.folderHint'), 'articleFolder'),
        folderSetting(t('settings.opmlFolder.name'), t('settings.opmlFolder.desc'), 'folder'),
      ] },
      { name: t('settings.defaultMode'), render: setting => {
        setting.addDropdown(drop => {
          for (const value of modeSchema.options) drop.addOption(value, modeLabel(value));
          drop.setValue(settings.defaultMode).onChange(async value => {
            settings.defaultMode = modeSchema.parse(value); await this.plugin.persist();
          });
        });
      } },
      { name: t('settings.showImages.name'), desc: t('settings.showImages.desc'), render: setting => {
        setting.addToggle(toggle => toggle.setValue(settings.remoteImages).onChange(async value => {
          settings.remoteImages = value; await this.plugin.persist(); this.plugin.resetViews();
        }));
      } },
      { type: 'group', heading: t('settings.groupVersion'), items: [
        { name: t('settings.currentVersion', { version: this.plugin.manifest.version }), desc: t('settings.currentVersion.desc'), render: setting => {
          setting.addButton(button => button.setButtonText(t('settings.manageUpdates')).onClick(() => this.plugin.openSettings('community-plugins')));
        } },
        { name: t('settings.changelog'), render: setting => {
          const details = setting.descEl.createEl('details');
          details.createEl('summary', { text: t('settings.changelogSummary') });
          details.createEl('p', { text: t('settings.changelogBody') });
          details.createEl('a', { text: t('settings.changelogLink'), href: 'https://github.com/joeseesun/qiaomu-ai-rss/releases', attr: { target: '_blank', rel: 'noopener noreferrer' } });
        } },
      ] },
      { name: t('settings.localData.name'), desc: t('settings.localData.desc') },
    ];
    const reading = definitions[0];
    if (!('type' in reading) || reading.type !== 'group') return definitions;
    const excerpt = reading.items!.shift()!;
    reading.heading = t('settings.tab.reading');
    const buckets: Record<string, SettingDefinitionItem[]> = {
      reading: [reading, definitions[4], definitions[5]],
      sources: [{ name: t('pick.title'), desc: t('pick.description'), render: setting => {
        setting.addButton(button => button.setButtonText(t('pick.open')).onClick(() => { (this.app as App & { setting: { close(): void } }).setting.close(); this.plugin.pickCuratedSources(); }));
      } }, definitions[2], definitions[1]],
      excerpt: [definitions[3], excerpt, definitions[7]],
      lab: [{ name: t('lab.collection'), desc: t('lab.entryDescription'), render: setting => {
        setting.addButton(button => button.setButtonText(t('lab.manage')).onClick(() => this.plugin.openCollectionSettings()));
      } }],
      about: [definitions[6], {
        // Storage panel: sizes are computed when the tab opens, never serialized into definitions.
        name: t('settings.storage.name'), desc: t('settings.storage.calculating'), render: setting => {
          void this.plugin.storageStats().then(stats => {
            const parts = [`${t('settings.storage.data')} ${formatBytes(stats.dataJson)}`, `${t('settings.storage.cache')} ${formatBytes(stats.cacheJson)}`,
              `${t('settings.storage.images')} ${formatBytes(stats.images.bytes)} (${stats.images.files})`];
            setting.setName(t('settings.storage.name'));
            setting.setDesc(parts.join(' · '));
          });
          setting.addButton(button => button.setButtonText(t('settings.storage.clearImages')).onClick(() => {
            new ConfirmAction(this.plugin, t('settings.storage.clearImages'), t('settings.storage.clearImagesConfirm'), async () => {
              const cleared = await this.plugin.clearImages();
              new Notice(t('settings.storage.cleared', { size: formatBytes(cleared.bytes) })); this.update();
            }).open();
          }));
          setting.addButton(button => button.setButtonText(t('settings.storage.clearBodies')).onClick(() => {
            new ConfirmAction(this.plugin, t('settings.storage.clearBodies'), t('settings.storage.clearBodiesConfirm'), async () => {
              const freed = await this.plugin.clearAllBodies();
              new Notice(t('settings.storage.cleared', { size: formatBytes(freed.freedBytes) })); this.update();
            }).open();
          }));
        },
      }, ...([
        [t('about.reportBug'), t('about.reportBug.desc'), 'https://github.com/joeseesun/qiaomu-ai-rss/issues/new'],
        [t('about.email'), 'vista8@gmail.com', 'mailto:vista8@gmail.com'],
        [t('about.guide'), t('about.guide.desc'), 'https://github.com/joeseesun/qiaomu-ai-rss#readme'],
        ['向阳乔木', 'qiaomu.ai', 'https://qiaomu.ai/'],
        ['乔木博客', 'blog.qiaomu.ai', 'https://blog.qiaomu.ai/'],
        ['X', '@vista8', 'https://x.com/vista8'],
        ['GitHub', '@joeseesun', 'https://github.com/joeseesun'],
      ]).map(([name, label, href]) => ({ name, render: (setting: import('obsidian').Setting) => {
        setting.controlEl.createEl('a', { text: label, href, attr: { target: '_blank', rel: 'noopener noreferrer' } });
      } })), { name: t('about.wechat'), render: setting => { setting.controlEl.createSpan({ text: 'joeseesun' }); } },
      { name: t('about.donate'), desc: t('about.donate.desc'), render: setting => {
        setting.settingEl.addClass('qrs-settings-qr');
        setting.controlEl.createEl('img', { attr: { src: 'https://radio.qiaomu.ai/assets/qiaomu_reward_qr.png', alt: t('about.donateAlt'), loading: 'lazy', width: '160', height: '160' } });
      } },
      { name: t('about.followAccount'), desc: t('about.followAccount.desc'), render: setting => {
        setting.settingEl.addClass('qrs-settings-qr');
        setting.controlEl.createEl('img', { attr: { src: 'https://radio.qiaomu.ai/assets/qiaomu_wechat_public_account_qr.jpg', alt: t('about.followAlt'), loading: 'lazy', width: '160', height: '160' } });
      } },
      { name: t('about.license'), desc: t('about.license.desc'), render: setting => {
        setting.addButton(button => {
          button.setIcon('shield').onClick(() => this.plugin.openCollectionSettings(true));
          const label = button.buttonEl.createSpan({ cls: 'qrs-visually-hidden', text: t('lab.advanced') });
          label.id = 'qrs-about-admin-' + crypto.randomUUID(); button.buttonEl.setAttribute('aria-labelledby', label.id);
          button.buttonEl.addClass('qrs-about-admin-button');
          setting.descEl.append(button.buttonEl);
        });
      } }],
    };
    const tabLabels: Record<string, string> = { reading: t('settings.tab.reading'), sources: t('settings.tab.sources'), excerpt: t('settings.tab.excerpt'), lab: t('settings.tab.lab'), about: t('settings.tab.about') };
    return [{ name: 'Qiaomu AI RSS', searchable: false, render: setting => {
      setting.settingEl.addClass('qrs-settings-header');
      // Obsidian reuses the setting row when definitions update.
      setting.settingEl.querySelectorAll('.qrs-settings-tabs').forEach(nav => nav.remove());
      const nav = setting.settingEl.createDiv({ cls: 'qrs-settings-tabs', attr: { role: 'tablist' } });
      for (const section of Object.keys(buckets)) {
        const button = nav.createEl('button', { text: tabLabels[section], attr: { role: 'tab', 'aria-selected': String(section === this.section), tabindex: section === this.section ? '0' : '-1' } });
        button.onclick = () => { this.section = section as RssSettings['section']; this.update(); this.containerEl.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus(); };
        button.onkeydown = event => {
          const names = Object.keys(buckets), i = names.indexOf(section);
          const next = event.key === 'ArrowRight' ? (i + 1) % names.length : event.key === 'ArrowLeft' ? (i + names.length - 1) % names.length : event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); this.section = names[next] as RssSettings['section']; this.update(); this.containerEl.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus(); }
        };
      }
    } }, ...buckets[this.section]];
  }
}
