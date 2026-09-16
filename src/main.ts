import { EditorView } from '@codemirror/view';
import { MarkdownView, Notice, Plugin, PluginSettingTab, TFile, type App, type SettingDefinitionItem } from 'obsidian';
import { requestUrl } from 'obsidian';
import { RssApi } from './api';
import { attachContentCache, folderPath, initialState, modeLabels, modeSchema, readingFontSchema, splitContentCache, type Bundle, type Entry, type Mode, type State } from './model';
import { cleanCaptureMarkers, repairArticleLinks, appendDailyNoteLink, dailyNotePath, readDailyNoteSettings, renderDailyNoteTemplate } from './daily-note';
import { ReaderView, VIEW_TYPE } from './view';
import { vaultSourceId, VaultFolderPicker, VaultSources } from './vault-source';
import { readingFonts, selectableFonts, ReadingFonts } from './fonts';
import { registerImageDrops } from './image-drag';
import { LocalImages } from './images';
import { Subscriptions } from './subscriptions';
import { SubscriptionManager, type SubscriptionTab } from './subscription-ui';
import { DiscoveryView, DISCOVERY_VIEW_TYPE } from './discovery-view';
import { SourceHealthModal } from './source-health';
import { stripFeedBodies } from './model';

export default class QiaomuRssPlugin extends Plugin {
  fonts = new ReadingFonts();
  vaultSources = new VaultSources(this.app);
  state: State = initialState(null);
  images!: LocalImages;
  subscriptions!: Subscriptions;
  private subscriptionManager?: SubscriptionManager;
  private lastNote: TFile | null = null;
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
    catch { new Notice('RSS 配置不兼容，已使用默认设置。'); }
    await this.loadContentCache();
    this.images = new LocalImages(this.app.vault, `${this.app.vault.configDir}/plugins/${this.manifest.id}/image-cache`);
    registerImageDrops(this);
    this.subscriptions = new Subscriptions(() => this.state, () => this.persist(), undefined, () => this.markBodiesDirty());
    this.addCommand({ id: 'manage-subscriptions', name: '管理我的订阅', callback: () => this.manageSubscriptions() });
    this.registerView(VIEW_TYPE, leaf => new ReaderView(leaf, this));
    this.registerView(DISCOVERY_VIEW_TYPE, leaf => new DiscoveryView(leaf, this));
    this.addCommand({ id: 'explore-subscriptions', name: '探索订阅', callback: () => { void this.openDiscovery(); } });
    this.addRibbonIcon('rss', '打开乔木 RSS 阅读器', () => { void this.openReader(); });
    this.addCommand({ id: 'open-reader', name: '打开乔木 RSS 阅读器', callback: () => { void this.openReader(); } });
    this.addCommand({ id: 'source-health', name: '来源阅读统计', callback: () => this.openSourceHealth() });
    this.addSettingTab(new RssSettings(this.app, this));
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
        .catch(() => new Notice('这篇文章的本地副本不存在，请使用旁边的原文链接。'));
    }, { capture: true });
    registerLinks(document);
    this.registerEvent(this.app.workspace.on('window-open', (_window, win) => registerLinks(win.document)));
    this.registerObsidianProtocolHandler('qiaomu-ai-rss', params => {
      void this.openSavedArticle(params.article || '', params.mode || 'original').catch(() => new Notice('这篇文章的本地副本不存在。'));
    });
  }
  onunload() { this.fonts.dispose(); }
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
    } catch { new Notice('无法打开 RSS 阅读器。'); }
  }
  persist(): Promise<void> {
    this.saving = this.saving.catch(() => undefined).then(() => this.saveSplit());
    return this.saving;
  }
  private cachePath() { return `${this.app.vault.configDir}/plugins/${this.manifest.id}/content-cache.json`; }
  private cacheDirty = true;
  markBodiesDirty() { this.cacheDirty = true; }
  private async saveSplit(): Promise<void> {
    // data.json keeps config + metadata only; entry bodies go to a rebuildable cache file,
    // rewritten only when bodies actually changed (scroll checkpoints must not rewrite 21MB).
    const { slim, cache } = splitContentCache(this.state);
    await this.saveData(slim);
    if (!this.cacheDirty) return;
    try { await this.app.vault.adapter.write(this.cachePath(), JSON.stringify(cache)); this.cacheDirty = false; }
    catch { /* body cache is rebuildable from feeds; a write failure must not break state save */ }
  }
  private async loadContentCache(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(this.cachePath()));
      if (parsed && typeof parsed === 'object') attachContentCache(this.state, parsed as Record<string, string>);
    } catch { /* no cache yet; bodies rehydrate on next refresh */ }
  }
  isLater(id: string): boolean { return this.state.readLater.includes(id); }
  openSourceHealth() {
    new SourceHealthModal(this.app, () => this.state, async id => {
      await this.subscriptions.remove(id);
      this.resetViews();
    }, () => this.resetViews()).open();
  }
  async storageStats() {
    const dir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const sizeOf = async (path: string): Promise<number> => (await this.app.vault.adapter.stat(path))?.size ?? 0;
    const [dataJson, cacheJson, images] = await Promise.all([
      sizeOf(`${dir}/data.json`), sizeOf(`${dir}/content-cache.json`), this.images.usage(),
    ]);
    const perSource = this.state.subscriptions.map(feed => ({
      id: feed.id, name: feed.name, entries: feed.entries.length,
      bodyBytes: feed.entries.reduce((n, e) => n + (e.content?.length ?? 0), 0),
      bodyCount: feed.entries.filter(e => e.content).length,
    })).sort((a, b) => b.bodyBytes - a.bodyBytes);
    const bodyTotal = perSource.reduce((n, s) => n + s.bodyBytes, 0);
    return { dataJson, cacheJson, images, perSource, bodyTotal };
  }
  async clearSourceBodies(id: string): Promise<{ freedBytes: number; freedCount: number }> {
    const feed = this.state.subscriptions.find(item => item.id === id);
    if (!feed) return { freedBytes: 0, freedCount: 0 };
    const { entries, freedBytes, freedCount } = stripFeedBodies(feed.entries);
    feed.entries = entries;
    if (freedCount) this.markBodiesDirty();
    await this.persist();
    return { freedBytes, freedCount };
  }
  async clearAllBodies(): Promise<{ freedBytes: number; freedCount: number }> {
    let freedBytes = 0, freedCount = 0;
    for (const feed of this.state.subscriptions) {
      const result = stripFeedBodies(feed.entries);
      feed.entries = result.entries; freedBytes += result.freedBytes; freedCount += result.freedCount;
    }
    if (freedCount) this.markBodiesDirty();
    await this.persist();
    return { freedBytes, freedCount };
  }
  async clearImages(): Promise<{ files: number; bytes: number }> { return this.images.clear(); }
  async toggleLater(entry: Entry): Promise<boolean> {
    const queued = this.state.readLater.includes(entry.id);
    this.state.readLater = queued
      ? this.state.readLater.filter(id => id !== entry.id)
      : [...this.state.readLater, entry.id].slice(-200);
    await this.persist();
    return !queued;
  }
  remember(bundle: Bundle) {
    if (bundle.entry.content) this.markBodiesDirty();
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
    }).catch(() => { new Notice('旧摘录标记暂未清理，请重新打开笔记重试。'); });
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
      if (target && this.app.vault.getAbstractFileByPath(target.path) !== target) throw new Error('目标笔记已不存在。');
      const settings = target ? { folder: '', format: '', template: '' } : await readDailyNoteSettings(this.app.vault);
      const path = target?.path ?? dailyNotePath(settings);
      let existing = this.app.vault.getAbstractFileByPath(path);
      let added = false;
      if (existing && !(existing instanceof TFile)) throw new Error('今日日记路径已被文件夹占用。');
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
      if (!(existing instanceof TFile)) throw new Error('无法创建今日日记。');
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
  manageSubscriptions(tab: SubscriptionTab = 'mine') {
    this.subscriptionManager?.close();
    this.subscriptionManager = new SubscriptionManager(this, () => {
      this.refreshDiscovery();
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof ReaderView) leaf.view.showSubscriptions();
      }
    }, tab);
    this.subscriptionManager.open();
  }
  openDiscovery(): Promise<void> { this.manageSubscriptions('explore'); return Promise.resolve(); }
  refreshDiscovery() {
    this.subscriptionManager?.refresh();
    for (const leaf of this.app.workspace.getLeavesOfType(DISCOVERY_VIEW_TYPE)) {
      if (leaf.view instanceof DiscoveryView) leaf.view.refresh();
    }
  }
  async activateSubscription(id: string) {
    if (!this.state.subscriptions.some(feed => feed.id === id)) return;
    this.state.settings.lastSource = id; await this.persist();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof ReaderView) leaf.view.showSubscription(id);
    }
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
  private section = '阅读';
  constructor(app: App, private plugin: QiaomuRssPlugin) { super(app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.state.settings;
    const saveReading = async () => { this.plugin.refreshPreferences(); await this.plugin.persist(); };
    const definitions: SettingDefinitionItem[] = [
      { type: 'group', heading: '阅读与摘录', items: [
        { name: '选中文字时显示摘录浮层', desc: '默认开启。选中文字后可追加到今日日记或当前笔记。', render: setting => {
          setting.addToggle(toggle => toggle.setValue(settings.selectionPopup).onChange(async value => { settings.selectionPopup = value; await saveReading(); }));
        } },
        { name: '正文字体', render: setting => { setting.addDropdown(drop => {
          for (const font of selectableFonts.concat(readingFonts.filter(f => f.id === settings.fontFamily && !selectableFonts.includes(f)))) drop.addOption(font.id, font.name);
          drop.setValue(settings.fontFamily).onChange(async value => { settings.fontFamily = readingFontSchema.parse(value); await saveReading(); this.update(); });
        }); } },
        { name: '设备字体名称', desc: '填写本机已安装的字体名称；其他设备没有此字体时使用系统衬线字体。', visible: () => settings.fontFamily === 'custom', render: setting => { setting.addText(text => text.setPlaceholder('填写设备中的字体名称').setValue(settings.customFont).onChange(async value => { settings.customFont = value.slice(0, 200); await saveReading(); })); } },
        { name: '正文字号', render: setting => { setting.addDropdown(drop => {
          for (let size = 14; size <= 32; size++) drop.addOption(String(size), size + ' px');
          drop.setValue(String(settings.fontSize)).onChange(async value => { settings.fontSize = Number(value); await saveReading(); });
        }); } },
        { name: '正文行距', render: setting => { setting.addDropdown(drop => {
          for (let value = 15; value <= 24; value++) drop.addOption((value / 10).toFixed(1), (value / 10).toFixed(1) + ' 倍');
          drop.setValue(settings.lineHeight.toFixed(1)).onChange(async value => { settings.lineHeight = Number(value); await saveReading(); });
        }); } },
        { name: '正文宽度', render: setting => { setting.addDropdown(drop => {
          for (const width of [28, 36, 44]) drop.addOption(String(width), width + ' 字');
          drop.setValue(String(settings.lineWidth)).onChange(async value => { settings.lineWidth = Number(value) as 28 | 36 | 44; await saveReading(); });
        }); } },
      ] },
      { type: 'group', heading: '库内 Markdown 来源', items: [
        { name: '阅读文件夹', desc: '包含子文件夹。可选择剪藏目录或其他 Markdown 文件夹；通过频道菜单进入。', render: setting => {
          setting.addButton(button => button.setButtonText('添加文件夹').onClick(() => {
            new VaultFolderPicker(this.app, folder => {
              if (!settings.markdownFolders.includes(folder.path)) settings.markdownFolders.push(folder.path);
              settings.lastSource = vaultSourceId(folder.path);
              void this.plugin.persist().then(() => { this.plugin.resetViews(); this.update(); });
            }).open();
          }));
        } },
        ...settings.markdownFolders.map(folder => ({ name: folder === '/' ? '整个库' : folder, render: (setting: import('obsidian').Setting) => {
          setting.addButton(button => button.setButtonText('移除').onClick(async () => {
            settings.markdownFolders = settings.markdownFolders.filter(path => path !== folder);
            await this.plugin.persist(); this.plugin.resetViews(); this.update();
          }));
        } })),
      ] },
      { name: '我的订阅', desc: '添加 RSS / Atom、分组与 OPML 导入导出。', render: setting => {
        setting.addButton(button => button.setButtonText('管理订阅').onClick(() => this.plugin.manageSubscriptions()));
        setting.addButton(button => button.setButtonText('阅读统计').onClick(() => this.plugin.openSourceHealth()));
      } },
      { name: 'OPML 导出文件夹', desc: '导出的 OPML 文件保存在这个库内文件夹。文章链接会写入 Obsidian 的今日日记。', render: setting => {
        setting.addText(text => text.setValue(settings.folder).onChange(value => { this.pendingFolder = value; }))
          .addButton(button => button.setButtonText('保存').onClick(async () => {
            try { settings.folder = folderPath(this.pendingFolder ?? settings.folder); await this.plugin.persist(); new Notice('文件夹已保存。'); }
            catch (error) { new Notice(error instanceof Error ? error.message : '无法保存设置。'); }
          }));
      } },
      { name: '默认阅读版本', render: setting => {
        setting.addDropdown(drop => {
          for (const [value, label] of Object.entries(modeLabels)) drop.addOption(value, label);
          drop.setValue(settings.defaultMode).onChange(async value => {
            settings.defaultMode = modeSchema.parse(value); await this.plugin.persist();
          });
        });
      } },
      { name: '显示文章图片', desc: '正文与列表缩略图下载到本库插件缓存后显示（最多 64 MB），再次阅读优先使用本地文件。', render: setting => {
        setting.addToggle(toggle => toggle.setValue(settings.remoteImages).onChange(async value => {
          settings.remoteImages = value; await this.plugin.persist(); this.plugin.resetViews();
        }));
      } },
      { type: 'group', heading: '版本与更新', items: [
        { name: `当前版本 ${this.plugin.manifest.version}`, desc: '在 Obsidian 第三方插件中检查并安装更新。更新记录可随时在这里查看。', render: setting => {
          setting.addButton(button => button.setButtonText('管理插件更新').onClick(() => this.plugin.openSettings('community-plugins')));
        } },
        { name: '更新记录', render: setting => {
          const details = setting.descEl.createEl('details');
          details.createEl('summary', { text: '查看本次更新' });
          details.createEl('p', { text: '修复设置 tab 菜单重复；空白阅读区新增场景提示与快捷键。保留离线朱雀仿宋、设备字体和频道阅读进度。' });
          details.createEl('a', { text: '完整更新记录', href: 'https://github.com/joeseesun/qiaomu-ai-rss/releases', attr: { target: '_blank', rel: 'noopener noreferrer' } });
        } },
      ] },
      { name: '本地数据', desc: '已读、收藏与缓存保存在当前库。浏览频道、切换文章或刷新时请求服务，不会上传你的笔记。' },
      { type: 'group', heading: '存储与缓存', items: [
        { name: '占用情况', desc: '切换到本页时计算一次。正文缓存可删、可重建。', render: setting => {
          const el = setting.descEl.createDiv({ text: '计算中…' });
          void this.plugin.storageStats().then(stats => {
            const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
            el.setText(`配置 ${mb(stats.dataJson)} · 正文缓存文件 ${mb(stats.cacheJson)} · 图片 ${stats.images.files} 张 ${mb(stats.images.bytes)} · 内存正文 ${mb(stats.bodyTotal)}`);
          }).catch(() => el.setText('读取失败。'));
        } },
        { name: '清理图片缓存', desc: '缩略图与正文配图会在下次打开时重新下载。', render: setting => {
          setting.addButton(button => button.setButtonText('清理').onClick(() => {
            void this.plugin.clearImages().then(result => { new Notice(`已清理 ${result.files} 张图片`); this.update(); });
          }));
        } },
        { name: '清理全部正文缓存', desc: '删除内存与缓存文件中的正文（保留标题、摘要与收藏），下次刷新时重建。', render: setting => {
          let armed = false;
          setting.addButton(button => button.setButtonText('清理').onClick(() => {
            if (!armed) { armed = true; button.setButtonText('确认清理？'); return; }
            armed = false;
            void this.plugin.clearAllBodies().then(result => {
              new Notice(`已清理 ${result.freedCount} 篇正文`);
              this.update();
            });
          }));
        } },
        { name: '按源清理正文', desc: '只列正文体积前 8 的源，清理后下次刷新重建。', render: setting => {
          const el = setting.descEl.createDiv({ text: '计算中…' });
          void this.plugin.storageStats().then(stats => {
            el.empty();
            for (const source of stats.perSource.slice(0, 8)) {
              if (!source.bodyCount) continue;
              const row = el.createDiv();
              row.createSpan({ text: `${source.name} · ${source.bodyCount} 篇 ${(source.bodyBytes / 1024).toFixed(0)} KB ` });
              const button = row.createEl('button', { text: '清理' });
              button.addEventListener('click', () => {
                void this.plugin.clearSourceBodies(source.id).then(result => {
                  new Notice(`已清理 ${source.name} ${result.freedCount} 篇正文`); this.update();
                });
              });
            }
            if (!el.hasChildNodes()) el.setText('各源均无正文缓存。');
          }).catch(() => el.setText('读取失败。'));
        } },
      ] },
    ];
    const reading = definitions[0];
    if (!('type' in reading) || reading.type !== 'group') return definitions;
    const excerpt = reading.items!.shift()!;
    reading.heading = '阅读';
    const buckets: Record<string, SettingDefinitionItem[]> = {
      '阅读': [reading, definitions[4], definitions[5]],
      '来源': [definitions[2], definitions[1], definitions[3]],
      '摘录': [excerpt, definitions[7]],
      '存储': [definitions[8]],
      '关于': [definitions[6], ...[
        ['建议与问题反馈', 'GitHub Issues', 'https://github.com/joeseesun/qiaomu-ai-rss/issues'],
        ['使用说明', '打开说明', 'https://github.com/joeseesun/qiaomu-ai-rss#readme'],
        ['向阳乔木', 'qiaomu.ai', 'https://qiaomu.ai/'],
        ['乔木博客', 'blog.qiaomu.ai', 'https://blog.qiaomu.ai/'],
        ['X', '@vista8', 'https://x.com/vista8'],
        ['GitHub', '@joeseesun', 'https://github.com/joeseesun'],
      ].map(([name, label, href]) => ({ name, render: (setting: import('obsidian').Setting) => {
        setting.controlEl.createEl('a', { text: label, href, attr: { target: '_blank', rel: 'noopener noreferrer' } });
      } })), { name: '开源许可', desc: 'Copyright © 向阳乔木 · GPL-3.0-only。内置朱雀仿宋遵循 SIL OFL 1.1。' }],
    };
    return [{ name: 'Qiaomu AI RSS', searchable: false, render: setting => {
      setting.settingEl.addClass('qrs-settings-header');
      // Obsidian reuses the setting row when definitions update.
      setting.settingEl.querySelectorAll('.qrs-settings-tabs').forEach(nav => nav.remove());
      const nav = setting.settingEl.createDiv({ cls: 'qrs-settings-tabs', attr: { role: 'tablist' } });
      for (const section of Object.keys(buckets)) {
        const button = nav.createEl('button', { text: section, attr: { role: 'tab', 'aria-selected': String(section === this.section), tabindex: section === this.section ? '0' : '-1' } });
        button.onclick = () => { this.section = section; this.update(); this.containerEl.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus(); };
        button.onkeydown = event => {
          const names = Object.keys(buckets), i = names.indexOf(section);
          const next = event.key === 'ArrowRight' ? (i + 1) % names.length : event.key === 'ArrowLeft' ? (i + names.length - 1) % names.length : event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); this.section = names[next]; this.update(); this.containerEl.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus(); }
        };
      }
    } }, ...buckets[this.section]];
  }
  private pendingFolder?: string;
}
