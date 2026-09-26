import { migrateLibrary, moveSources, registerSource } from './personal-library';
import { EditorView } from '@codemirror/view';
import { MarkdownView, Notice, Plugin, PluginSettingTab, TFile, type App, type SettingDefinitionItem, type SettingGroupItem } from 'obsidian';
import { requestUrl } from 'obsidian';
import { RssApi } from './api';
import { folderPath, initialState, renameArticleNotes, modeLabel, modeSchema, readingFontSchema, type Bundle, type Entry, type Mode, type State } from './model';
import { cleanCaptureMarkers, repairArticleLinks, appendDailyNoteLink, dailyNotePath, readDailyNoteSettings, renderDailyNoteTemplate } from './daily-note';
import { ReaderView, VIEW_TYPE } from './view';
import { contextProvider } from './agent-bridge';
import { createHomeProvider } from './home';
import { notifyHomeChanged } from './qiaomu-home';
import { vaultSourceId, VaultFolderPicker, VaultSources } from './vault-source';
import { fontName, readingFonts, selectableFonts, ReadingFonts } from './fonts';
import { registerImageDrops } from './image-drag';
import { LocalImages } from './images';
import { Subscriptions } from './subscriptions';
import { RETIRED_VIEW_TYPES, RetiredView, SubscriptionCenter, type CenterTab } from './subscription-center';
import { t } from './i18n';
import { articleFolderPath } from './vault-export';

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
  private lastNote: TFile | null = null;
  private libraryEdits: Promise<void> = Promise.resolve();
  private saving: Promise<void> = Promise.resolve();
  private dailyNoteWrite: Promise<unknown> = Promise.resolve();
  async onload() {
    this.lastNote = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      if (leaf?.view instanceof MarkdownView && leaf.view.file) {
        this.lastNote = leaf.view.file; this.cleanNoteMarkers(leaf.view.file);
      }
    }));
    const data: unknown = await this.loadData();
    try { this.state = initialState(data); }
    catch { new Notice(t('notice.dataUnreadable')); throw new Error('Incompatible RSS data'); }
    if (data && typeof data === 'object' && !('libraryVersion' in data)) {
      const backup = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data-before-library-v1.json`;
      if (!await this.app.vault.adapter.exists(backup)) await this.app.vault.adapter.write(backup, JSON.stringify(data));
      await this.persist();
    }
    this.images = new LocalImages(this.app.vault, `${this.app.vault.configDir}/plugins/${this.manifest.id}/image-cache`);
    registerImageDrops(this);
    this.subscriptions = new Subscriptions(() => this.state, () => this.persist().then(() => { this.refreshDiscovery(); this.refreshPersonalViews(); }));
    this.addCommand({ id: 'manage-subscriptions', name: t('cmd.manageSubscriptions'), callback: () => this.manageSubscriptions() });
    this.registerView(VIEW_TYPE, leaf => new ReaderView(leaf, this));
    for (const type of RETIRED_VIEW_TYPES) this.registerView(type, leaf => new RetiredView(leaf, type));
    const retire = () => { for (const type of RETIRED_VIEW_TYPES) for (const leaf of this.app.workspace.getLeavesOfType(type)) leaf.detach(); };
    this.app.workspace.onLayoutReady(() => { retire(); window.setTimeout(retire, 500); });
    this.addCommand({ id: 'explore-subscriptions', name: t('cmd.exploreSubscriptions'), callback: () => { void this.openDiscovery(); } });
    this.addRibbonIcon('rss', t('cmd.openReader'), () => { void this.openReader(); });
    this.addCommand({ id: 'open-reader', name: t('cmd.openReader'), callback: () => { void this.openReader(); } });
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
  onunload() { this.center?.close(); this.fonts.dispose(); }
  api(): RssApi {
    return new RssApi(this.state.settings.baseUrl, async url => {
      const response = await requestUrl({ url, method: 'GET', headers: { Accept: 'application/json' }, throw: false });
      return { status: response.status, text: response.text };
    });
  }
  async openReader() {
    try {
      let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
      await leaf.loadIfDeferred();
      await this.app.workspace.revealLeaf(leaf);
    } catch { new Notice(t('notice.cannotOpenReader')); }
  }
  persist(): Promise<void> {
    this.saving = this.saving.catch(() => undefined).then(() => this.saveData(this.state));
    // Read state, favorites and fetched entries all persist through here; Home coalesces bursts.
    void this.saving.then(() => notifyHomeChanged(this.app, this.manifest.id), () => undefined);
    return this.saving;
  }
  remember(bundle: Bundle) {
    this.state.cache[bundle.entry.id] = bundle;
    const recent = Object.values(this.state.cache).sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, 40);
    this.state.cache = Object.fromEntries(recent.map(value => [value.entry.id, value]));
    if (this.state.favorites[bundle.entry.id]) this.state.favorites[bundle.entry.id] = bundle;
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
    let result!: { file: TFile; added: boolean };
    const write = async () => {
      const id = `${entry.origin === 'local' ? 'local' : entry.origin === 'vault' ? 'vault' : this.state.settings.baseUrl}|${entry.id}`;
      const bundle = this.state.cache[entry.id] || this.state.favorites[entry.id] || { entry, rewrite: entry.rewrite || null, translation: null, fetchedAt: Date.now() };
      this.state.savedArticles[id] = bundle;
      await this.persist();
      const options = { vault: this.app.vault.getName(), article: id, mode, excerpt };
      if (target && this.app.vault.getAbstractFileByPath(target.path) !== target) throw new Error(t('error.targetNoteMissing'));
      const settings = target ? { folder: '', format: '', template: '' } : await readDailyNoteSettings(this.app.vault);
      const path = target?.path ?? dailyNotePath(settings);
      let existing = this.app.vault.getAbstractFileByPath(path);
      let added = false;
      if (existing && !(existing instanceof TFile)) throw new Error(t('error.dailyNotePathOccupied'));
      if (!(existing instanceof TFile)) {
        await this.ensureFolder(path);
        let template = '';
        if (settings.template) {
          const templateFile = this.app.vault.getAbstractFileByPath(`${settings.template}.md`);
          if (templateFile instanceof TFile) template = renderDailyNoteTemplate(await this.app.vault.read(templateFile), path.split('/').at(-1)?.replace(/\.md$/i, '') || '');
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
  private section: 'reading' | 'sources' | 'excerpt' | 'about' = 'reading';
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
      sources: [definitions[2], definitions[1]],
      excerpt: [definitions[3], excerpt, definitions[7]],
      about: [definitions[6], ...([
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
      { name: t('about.license'), desc: t('about.license.desc') }],
    };
    const tabLabels: Record<string, string> = { reading: t('settings.tab.reading'), sources: t('settings.tab.sources'), excerpt: t('settings.tab.excerpt'), about: t('settings.tab.about') };
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
