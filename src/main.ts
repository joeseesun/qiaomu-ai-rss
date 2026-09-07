import { EditorView } from '@codemirror/view';
import { MarkdownView, Notice, Plugin, PluginSettingTab, TFile, type App, type SettingDefinitionItem } from 'obsidian';
import { requestUrl } from 'obsidian';
import { RssApi } from './api';
import { folderPath, initialState, modeLabels, modeSchema, readingFontSchema, type Bundle, type Entry, type Mode, type State } from './model';
import { cleanCaptureMarkers, repairArticleLinks, appendDailyNoteLink, dailyNotePath, readDailyNoteSettings, renderDailyNoteTemplate } from './daily-note';
import { ReaderView, VIEW_TYPE } from './view';
import { vaultSourceId, VaultFolderPicker, VaultSources } from './vault-source';
import { readingFonts, ReadingFonts } from './fonts';
import { registerImageDrops } from './image-drag';
import { LocalImages } from './images';
import { Subscriptions } from './subscriptions';
import { SubscriptionManager, type SubscriptionTab } from './subscription-ui';
import { DiscoveryView, DISCOVERY_VIEW_TYPE } from './discovery-view';

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
    this.images = new LocalImages(this.app.vault, `${this.app.vault.configDir}/plugins/${this.manifest.id}/image-cache`);
    registerImageDrops(this);
    this.subscriptions = new Subscriptions(() => this.state, () => this.persist());
    this.addCommand({ id: 'manage-subscriptions', name: '管理我的订阅', callback: () => this.manageSubscriptions() });
    this.registerView(VIEW_TYPE, leaf => new ReaderView(leaf, this));
    this.registerView(DISCOVERY_VIEW_TYPE, leaf => new DiscoveryView(leaf, this));
    this.addCommand({ id: 'explore-subscriptions', name: '探索订阅', callback: () => { void this.openDiscovery(); } });
    this.addRibbonIcon('rss', '打开乔木 RSS 阅读器', () => { void this.openReader(); });
    this.addCommand({ id: 'open-reader', name: '打开乔木 RSS 阅读器', callback: () => { void this.openReader(); } });
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
    this.saving = this.saving.catch(() => undefined).then(() => this.saveData(this.state));
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
  constructor(app: App, private plugin: QiaomuRssPlugin) { super(app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.state.settings;
    const saveReading = async () => { this.plugin.refreshPreferences(); await this.plugin.persist(); };
    return [
      { type: 'group', heading: '阅读与摘录', items: [
        { name: '选中文字时显示摘录浮层', desc: '默认开启。选中文字后可追加到今日日记或当前笔记。', render: setting => {
          setting.addToggle(toggle => toggle.setValue(settings.selectionPopup).onChange(async value => { settings.selectionPopup = value; await saveReading(); }));
        } },
        { name: '正文字体', render: setting => { setting.addDropdown(drop => {
          for (const font of readingFonts) drop.addOption(font.id, font.name);
          drop.setValue(settings.fontFamily).onChange(async value => { settings.fontFamily = readingFontSchema.parse(value); await saveReading(); });
        }); } },
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
          details.createEl('p', { text: '搜索框增加清除按钮；设置中增加版本与更新记录入口。频道切换保留文章、列表和阅读位置。' });
          details.createEl('a', { text: '完整更新记录', href: 'https://github.com/joeseesun/qiaomu-ai-rss/releases', attr: { target: '_blank', rel: 'noopener noreferrer' } });
        } },
      ] },
      { name: '本地数据', desc: '已读、收藏与缓存保存在当前库。浏览频道、切换文章或刷新时请求服务，不会上传你的笔记。' },
    ];
  }
  private pendingFolder?: string;
}
